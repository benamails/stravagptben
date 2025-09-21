// app/api/debug/user-activities/migrate-to-raw/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const cleanDetails = searchParams.get('clean_details') === 'true';
  
  try {
    console.log(`🔄 Migration ${dryRun ? '(DRY RUN)' : '(RÉELLE)'} vers données brutes...`);
    
    const migrationReport = {
      processed_activities: 0,
      deleted_formatted: 0,
      migrated_raw: 0,
      cleaned_details: 0,
      deleted_user_lists: 0,
      created_global_list: false,
      errors: [] as string[]
    };
    
    // 1. Scanner toutes les clés activity:*
    console.log('📡 Scan des activités...');
    let cursor = "0";
    const allKeys: string[] = [];
    
    do {
      const result = await redis.scan(cursor, {
        match: 'activity:*',
        count: 100
      });
      
      cursor = result[0];
      allKeys.push(...result[1]);
      
    } while (cursor !== "0" && allKeys.length < 2000);
    
    // 2. Séparer les différents types de clés
    const formattedKeys = allKeys.filter(key => 
      /^activity:\d+$/.test(key) // Seulement activity:ID (pas :raw, pas :details)
    );
    const rawKeys = allKeys.filter(key => key.includes(':raw'));
    const detailKeys = allKeys.filter(key => key.includes('activity_details:'));
    
    console.log(`📊 Trouvé:`);
    console.log(`  - ${formattedKeys.length} activités formatées`);
    console.log(`  - ${rawKeys.length} activités brutes`);
    console.log(`  - ${detailKeys.length} détails d'activités`);
    
    // 3. Nettoyer les détails erronés si demandé
    if (cleanDetails) {
      console.log('🧹 Nettoyage des activity_details...');
      
      for (const detailKey of detailKeys) {
        try {
          const detailData = await redis.get(detailKey);
          let shouldDelete = false;
          
          if (detailData) {
            const parsed = typeof detailData === 'string' ? JSON.parse(detailData) : detailData;
            
            // Vérifier si les données sont corrompues/erronées
            if (!parsed.id || !parsed.start_date || parsed.start_date === '1970-01-01T00:00:00Z') {
              shouldDelete = true;
            }
          } else {
            shouldDelete = true; // Clé vide
          }
          
          if (shouldDelete && !dryRun) {
            await redis.del(detailKey);
            migrationReport.cleaned_details++;
            console.log(`🗑️ Supprimé détail erroné: ${detailKey}`);
          } else if (shouldDelete) {
            console.log(`[DRY] Supprimerait détail erroné: ${detailKey}`);
            migrationReport.cleaned_details++;
          }
          
        } catch (error) {
          migrationReport.errors.push(`Erreur nettoyage ${detailKey}: ${error}`);
        }
      }
    }
    
    // 4. Migration des activités : raw → principal
    console.log('🔄 Migration des activités...');
    const activityIds = new Set<string>();
    
    // Extraire tous les IDs uniques
    [...formattedKeys, ...rawKeys].forEach(key => {
      const match = key.match(/^activity:(\d+)(:raw)?$/);
      if (match) {
        activityIds.add(match[1]);
      }
    });
    
    console.log(`🎯 ${activityIds.size} activités uniques à traiter`);
    
    const validActivityIds: string[] = [];
    
    for (const activityId of Array.from(activityIds)) {
      migrationReport.processed_activities++;
      
      try {
        const formattedKey = `activity:${activityId}`;
        const rawKey = `activity:${activityId}:raw`;
        
        const [formattedExists, rawExists] = await Promise.all([
          redis.exists(formattedKey),
          redis.exists(rawKey)
        ]);
        
        if (rawExists) {
          const rawData = await redis.get(rawKey);
          
          if (rawData && !dryRun) {
            // Supprimer l'ancienne version formatée
            if (formattedExists) {
              await redis.del(formattedKey);
              migrationReport.deleted_formatted++;
            }
            
            // Copier raw → principal
            await redis.set(formattedKey, typeof rawData === 'string' ? rawData : JSON.stringify(rawData));
            
            // Supprimer le raw
            await redis.del(rawKey);
            
            migrationReport.migrated_raw++;
            validActivityIds.push(activityId);
            console.log(`✅ Migré: ${rawKey} → ${formattedKey}`);
          } else if (rawData) {
            // Dry run
            console.log(`[DRY] Migrerait: ${rawKey} → ${formattedKey}`);
            migrationReport.migrated_raw++;
            validActivityIds.push(activityId);
            if (formattedExists) migrationReport.deleted_formatted++;
          }
        } else if (formattedExists) {
          // Garder l'activité formatée existante
          validActivityIds.push(activityId);
          console.log(`📝 Garde activité formatée: ${formattedKey}`);
        }
        
      } catch (error) {
        const errorMsg = `Erreur activité ${activityId}: ${error instanceof Error ? error.message : 'Unknown'}`;
        migrationReport.errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }
    
    // 5. Supprimer les anciennes listes utilisateur
    console.log('🧹 Nettoyage des listes utilisateur...');
    const userListKeys = await redis.keys('user:*:activities');
    
    if (userListKeys.length > 0 && !dryRun) {
      for (const key of userListKeys) {
        await redis.del(key);
        migrationReport.deleted_user_lists++;
        console.log(`🗑️ Supprimé liste utilisateur: ${key}`);
      }
    } else if (userListKeys.length > 0) {
      console.log(`[DRY] Supprimerait ${userListKeys.length} listes utilisateur`);
      migrationReport.deleted_user_lists = userListKeys.length;
    }
    
    // 6. Créer la liste globale activities:ids
    console.log('📋 Création de la liste globale...');
    
    if (validActivityIds.length > 0 && !dryRun) {
      // Trier par ID décroissant (plus récent en premier, approximativement)
      validActivityIds.sort((a, b) => parseInt(b) - parseInt(a));
      
      // Supprimer l'ancienne liste s'il y en a une
      await redis.del('activities:ids');
      
      // Créer la nouvelle liste
      await redis.lpush('activities:ids', ...validActivityIds);
      
      migrationReport.created_global_list = true;
      console.log(`📋 Liste globale créée: ${validActivityIds.length} activités`);
    } else if (validActivityIds.length > 0) {
      console.log(`[DRY] Créerait liste globale avec ${validActivityIds.length} activités`);
      migrationReport.created_global_list = true;
    }
    
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      migration_report: migrationReport,
      valid_activities: validActivityIds.length,
      message: dryRun 
        ? `Dry run terminé. ${migrationReport.migrated_raw} activités seraient migrées, ${migrationReport.cleaned_details} détails nettoyés.`
        : `Migration terminée! Structure simplifiée avec liste globale activities:ids.`
    });
    
  } catch (error) {
    console.error('❌ Erreur migration:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
