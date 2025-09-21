import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  
  try {
    console.log(`🔧 Quick fix ${dryRun ? '(DRY RUN)' : '(RÉEL)'}`);
    
    const report = {
      step1_check_type: '',
      step2_activities_found: 0,
      step3_list_created: false,
      execution_time: 0
    };
    
    const startTime = Date.now();
    
    // ÉTAPE 1: Vérifier et corriger le type de activities:ids
    console.log('🔍 Étape 1: Vérification de activities:ids');
    
    const type = await redis.type('activities:ids');
    report.step1_check_type = type;
    
    if (type !== 'list' && type !== 'none') {
      console.log(`⚠️ Type incorrect détecté: ${type}`);
      if (!dryRun) {
        await redis.del('activities:ids');
        console.log('🗑️ Clé corrompue supprimée');
      }
    }
    
    // ÉTAPE 2: Scanner les activités avec SCAN (éviter KEYS *)
    console.log('🔍 Étape 2: Scan des activités');
    
    const validActivityIds: string[] = [];
    let cursor = "0";
    let scanCount = 0;
    
    do {
      const result = await redis.scan(cursor, {
        match: 'activity:*',
        count: 100
      });
      
      cursor = result[0];
      const keys = result[1];
      scanCount++;
      
      // Filtrer les clés d'activités valides
      for (const key of keys) {
        const match = key.match(/^activity:(\d+)$/);
        if (match && !key.includes(':raw') && !key.includes('activity_details:')) {
          validActivityIds.push(match[1]);
        }
      }
      
      // Limiter pour éviter timeout
      if (scanCount >= 20 || validActivityIds.length >= 500) {
        break;
      }
      
    } while (cursor !== "0");
    
    report.step2_activities_found = validActivityIds.length;
    console.log(`📊 Trouvé ${validActivityIds.length} activités valides en ${scanCount} scans`);
    
    // ÉTAPE 3: Recréer la liste activities:ids
    console.log('🔍 Étape 3: Création de la liste');
    
    if (validActivityIds.length > 0 && !dryRun) {
      // Trier par ID décroissant (plus récent en premier)
      validActivityIds.sort((a, b) => parseInt(b) - parseInt(a));
      
      // Supprimer l'ancienne liste et créer la nouvelle
      await redis.del('activities:ids');
      await redis.lpush('activities:ids', ...validActivityIds);
      
      report.step3_list_created = true;
      console.log(`✅ Liste activities:ids créée avec ${validActivityIds.length} éléments`);
    }
    
    report.execution_time = Date.now() - startTime;
    
    // ÉTAPE 4: Vérification finale
    const finalCheck = await redis.type('activities:ids');
    const finalLength = finalCheck === 'list' ? await redis.llen('activities:ids') : 0;
    
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      report: report,
      final_check: {
        type: finalCheck,
        length: finalLength,
        sample_ids: validActivityIds.slice(0, 5)
      },
      message: dryRun 
        ? `Dry run: ${validActivityIds.length} activités trouvées, liste serait créée`
        : `Fix terminé: liste créée avec ${finalLength} activités`
    });
    
  } catch (error) {
    console.error('❌ Erreur quick fix:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
