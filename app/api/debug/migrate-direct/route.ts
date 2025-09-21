import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const limit = parseInt(searchParams.get('limit') || '100');
  
  try {
    console.log(`🔄 Migration directe ${dryRun ? '(DRY RUN)' : '(RÉELLE)'}, limite: ${limit}`);
    
    const startTime = Date.now();
    
    const report = {
      scanned_raw: 0,
      migrated: 0,
      deleted_formatted: 0,
      deleted_raw: 0,
      errors: [] as string[],
      execution_time: 0
    };
    
    // 1. Scanner directement les clés :raw (plus efficace)
    let cursor = "0";
    const rawKeys: string[] = [];
    
    do {
      const result = await redis.scan(cursor, {
        match: 'activity:*:raw',
        count: 200
      });
      
      cursor = result[0];
      rawKeys.push(...result[1]);
      
      // Limiter pour éviter les timeouts
      if (rawKeys.length >= limit * 2) {
        break;
      }
      
    } while (cursor !== "0");
    
    console.log(`📡 Trouvé ${rawKeys.length} activités :raw`);
    
    // 2. Traiter chaque activité :raw
    const validIds: string[] = [];
    
    for (const rawKey of rawKeys.slice(0, limit)) {
      report.scanned_raw++;
      
      // Vérifier le temps pour éviter timeout
      if (Date.now() - startTime > 25000) {
        console.log('⏰ Timeout approché, arrêt');
        break;
      }
      
      try {
        // Extraire l'ID
        const match = rawKey.match(/^activity:(\d+):raw$/);
        if (!match) continue;
        
        const activityId = match[1];
        const formattedKey = `activity:${activityId}`;
        
        if (!dryRun) {
          // Récupérer les données raw
          const rawData = await redis.get(rawKey);
          
          if (rawData) {
            // Supprimer l'ancien formaté s'il existe
            const formattedExists = await redis.exists(formattedKey);
            if (formattedExists) {
              await redis.del(formattedKey);
              report.deleted_formatted++;
              console.log(`🗑️ Supprimé formaté: ${formattedKey}`);
            }
            
            // Copier raw vers principal
            await redis.set(formattedKey, typeof rawData === 'string' ? rawData : JSON.stringify(rawData));
            
            // Supprimer le raw
            await redis.del(rawKey);
            report.deleted_raw++;
            
            report.migrated++;
            validIds.push(activityId);
            
            console.log(`✅ Migré: ${rawKey} → ${formattedKey}`);
            
            // Log de progression
            if (report.migrated % 10 === 0) {
              console.log(`📊 Progression: ${report.migrated}/${limit}`);
            }
          }
        } else {
          // Dry run
          const rawExists = await redis.exists(rawKey);
          const formattedExists = await redis.exists(formattedKey);
          
          if (rawExists) {
            report.migrated++;
            validIds.push(activityId);
            if (formattedExists) {
              report.deleted_formatted++;
            }
            report.deleted_raw++;
          }
        }
        
      } catch (error) {
        const errorMsg = `Erreur ${rawKey}: ${error instanceof Error ? error.message : 'Unknown'}`;
        report.errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }
    
    report.execution_time = Date.now() - startTime;
    
    // 3. Vérifier s'il reste des :raw à traiter
    const remainingRaw = await redis.keys('activity:*:raw');
    const hasMore = remainingRaw.length > 0;
    
    // 4. Si fini, créer la liste globale et nettoyer
    if (!hasMore && !dryRun && report.migrated > 0) {
      console.log('🎯 Migration terminée, création de la liste globale...');
      
      // Récupérer tous les IDs d'activités
      const allActivityKeys = await redis.keys('activity:*');
      const allIds = allActivityKeys
        .map(key => key.match(/^activity:(\d+)$/)?.[1])
        .filter(id => id && !isNaN(parseInt(id)))
        .sort((a, b) => parseInt(b!) - parseInt(a!)); // Trier par ID décroissant
      
      // Créer la liste globale
      await redis.del('activities:ids');
      if (allIds.length > 0) {
        await redis.lpush('activities:ids', ...allIds);
      }
      
      // Supprimer les listes utilisateur
      const userLists = await redis.keys('user:*:activities');
      for (const userList of userLists) {
        await redis.del(userList);
      }
      
      console.log(`📋 Liste globale créée: ${allIds.length} activités`);
    }
    
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      report: report,
      remaining_raw: hasMore ? remainingRaw.length : 0,
      next_action: hasMore 
        ? `curl -X POST "https://stravagptben.vercel.app/api/debug/migrate-direct?dry_run=${dryRun}&limit=${limit}"`
        : 'Migration terminée!',
      performance: {
        activities_per_second: Math.round(report.migrated / (report.execution_time / 1000)),
        execution_time_ms: report.execution_time
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur migration directe:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
