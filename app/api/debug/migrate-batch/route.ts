import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const batchSize = parseInt(searchParams.get('batch_size') || '50');
  const startCursor = searchParams.get('cursor') || '0';
  const cleanDetails = searchParams.get('clean_details') === 'true';
  
  try {
    console.log(`🔄 Migration batch ${dryRun ? '(DRY RUN)' : '(RÉELLE)'}, taille: ${batchSize}, cursor: ${startCursor}`);
    
    const startTime = Date.now();
    const maxExecutionTime = 25000; // 25 secondes max
    
    const batchReport = {
      processed: 0,
      migrated: 0,
      deleted: 0,
      errors: [] as string[],
      nextCursor: '0',
      completed: false,
      executionTime: 0
    };
    
    // 1. Scanner un batch d'activités
    const result = await redis.scan(startCursor, {
      match: 'activity:*',
      count: batchSize * 2 // Plus pour compenser les filtres
    });
    
    batchReport.nextCursor = result[0];
    const keys = result[1];
    
    // 2. Filtrer et grouper les clés
    const activityMap = new Map<string, { formatted?: string, raw?: string }>();
    
    for (const key of keys) {
      const match = key.match(/^activity:(\d+)(:raw)?$/);
      if (match) {
        const id = match[1];
        const isRaw = !!match[2];
        
        if (!activityMap.has(id)) {
          activityMap.set(id, {});
        }
        
        const entry = activityMap.get(id)!;
        if (isRaw) {
          entry.raw = key;
        } else {
          entry.formatted = key;
        }
      }
    }
    
    console.log(`📊 Batch trouvé: ${activityMap.size} activités uniques`);
    
    // 3. Traiter chaque activité du batch
    const validIds: string[] = [];
    
    for (const [id, entry] of Array.from(activityMap.entries())) {
      // Vérifier le temps d'exécution
      if (Date.now() - startTime > maxExecutionTime) {
        console.log('⏰ Timeout approché, arrêt du batch');
        break;
      }
      
      batchReport.processed++;
      
      try {
        if (entry.raw) {
          // Migration raw → principal
          const rawData = await redis.get(entry.raw);
          
          if (rawData && !dryRun) {
            // Supprimer l'ancien formaté s'il existe
            if (entry.formatted) {
              await redis.del(entry.formatted);
              batchReport.deleted++;
            }
            
            // Copier raw vers principal
            await redis.set(`activity:${id}`, typeof rawData === 'string' ? rawData : JSON.stringify(rawData));
            
            // Supprimer le raw
            await redis.del(entry.raw);
            
            batchReport.migrated++;
            validIds.push(id);
            
          } else if (rawData) {
            // Dry run
            batchReport.migrated++;
            validIds.push(id);
            if (entry.formatted) batchReport.deleted++;
          }
          
        } else if (entry.formatted) {
          // Garder l'activité formatée existante
          validIds.push(id);
        }
        
      } catch (error) {
        batchReport.errors.push(`Erreur ${id}: ${error}`);
      }
    }
    
    // 4. Nettoyer quelques détails erronés si demandé
    if (cleanDetails && !dryRun && Date.now() - startTime < maxExecutionTime - 2000) {
      const detailsResult = await redis.scan('0', {
        match: 'activity_details:*',
        count: 20
      });
      
      for (const detailKey of detailsResult[1].slice(0, 10)) {
        try {
          const detailData = await redis.get(detailKey);
          if (!detailData) {
            await redis.del(detailKey);
            batchReport.deleted++;
          }
        } catch (error) {
          // Ignorer les erreurs de nettoyage
        }
      }
    }
    
    batchReport.executionTime = Date.now() - startTime;
    batchReport.completed = batchReport.nextCursor === '0';
    
    // 5. Si c'est le dernier batch, créer la liste globale
    if (batchReport.completed && !dryRun && validIds.length > 0) {
      // Récupérer tous les IDs existants
      const allValidIds: string[] = [];
      let cursor = '0';
      
      do {
        const scanResult = await redis.scan(cursor, {
          match: 'activity:*',
          count: 100
        });
        
        cursor = scanResult[0];
        for (const key of scanResult[1]) {
          const match = key.match(/^activity:(\d+)$/);
          if (match && !key.includes(':')) {
            allValidIds.push(match[1]);
          }
        }
        
      } while (cursor !== '0' && allValidIds.length < 2000);
      
      // Créer la liste globale
      allValidIds.sort((a, b) => parseInt(b) - parseInt(a));
      await redis.del('activities:ids');
      if (allValidIds.length > 0) {
        await redis.lpush('activities:ids', ...allValidIds);
      }
      
      // Supprimer les anciennes listes utilisateur
      const userLists = await redis.keys('user:*:activities');
      for (const userList of userLists) {
        await redis.del(userList);
      }
      
      console.log(`📋 Liste globale créée: ${allValidIds.length} activités`);
    }
    
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      batch_report: batchReport,
      next_command: batchReport.completed 
        ? 'Migration terminée !' 
        : `curl -X POST "https://stravagptben.vercel.app/api/debug/migrate-batch?dry_run=${dryRun}&cursor=${batchReport.nextCursor}&batch_size=${batchSize}"`
    });
    
  } catch (error) {
    console.error('❌ Erreur batch:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
