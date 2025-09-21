import { NextRequest, NextResponse } from 'next/server';
import { getStoredUserToken } from '@/lib/redis';
import { fetchAndProcessActivity } from '@/lib/activity-processor';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('user_id') || '14060676');
  const dryRun = searchParams.get('dry_run') === 'true';
  const maxPages = parseInt(searchParams.get('max_pages') || '20'); // ~1000 activités max
  const flushFirst = searchParams.get('flush') === 'true';
  
  try {
    console.log(`🚀 REBUILD FROM STRAVA ${dryRun ? '(DRY RUN)' : '(RÉEL)'} - User: ${userId}`);
    
    const startTime = Date.now();
    const report = {
      flush_performed: false,
      strava_api_calls: 0,
      activities_found: 0,
      activities_processed: 0,
      activities_with_details: 0,
      errors: [] as string[],
      execution_time_ms: 0,
      rate_limit_remaining: 0
    };
    
    // 1. 🧹 FLUSH de la base si demandé
    if (flushFirst && !dryRun) {
      console.log('🧹 FLUSH de toutes les données...');
      
      // Supprimer toutes les clés liées aux activités
      let cursor = "0";
      const keysToDelete = [];
      
      do {
        const result = await redis.scan(cursor, {
          match: 'activity*',
          count: 100
        });
        cursor = result[0];
        keysToDelete.push(...result[1]);
      } while (cursor !== "0" && keysToDelete.length < 5000);
      
      if (keysToDelete.length > 0) {
        // Supprimer par batch pour éviter les timeouts
        for (let i = 0; i < keysToDelete.length; i += 50) {
          const batch = keysToDelete.slice(i, i + 50);
          await redis.del(...batch);
        }
      }
      
      // Nettoyer les listes spécifiques
      await redis.del('activities:ids', 'activities:last_activity');
      
      report.flush_performed = true;
      console.log(`🗑️ ${keysToDelete.length} clés supprimées`);
    }
    
    // 2. 📡 RÉCUPÉRATION depuis l'API Strava
    const tokenData = await getStoredUserToken(userId);
    if (!tokenData) {
      throw new Error('Token utilisateur introuvable');
    }
    
    const allActivities = [];
    let page = 1;
    
    console.log('📡 Récupération des activités depuis Strava...');
    
    while (page <= maxPages) {
      const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=50`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      });
      
      report.strava_api_calls++;
      
      if (!response.ok) {
        const error = `Strava API error page ${page}: ${response.status}`;
        report.errors.push(error);
        console.error(error);
        break;
      }
      
      // Récupérer les headers de rate limiting
      report.rate_limit_remaining = parseInt(response.headers.get('x-ratelimit-usage')?.split(',')[0] || '0');
      
      const pageActivities = await response.json();
      
      if (pageActivities.length === 0) {
        console.log(`📄 Page ${page}: Aucune activité, fin de pagination`);
        break;
      }
      
      allActivities.push(...pageActivities);
      report.activities_found += pageActivities.length;
      
      console.log(`📄 Page ${page}: ${pageActivities.length} activités (Total: ${allActivities.length})`);
      
      // Vérifier si on approche des limites de rate
      if (report.rate_limit_remaining > 500) { // Rate limit Strava = 1000/15min
        console.log('⚠️ Rate limit approché, arrêt préventif');
        break;
      }
      
      page++;
      
      // Délai pour respecter les limites
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ ${allActivities.length} activités récupérées depuis Strava`);
    
    // 3. 🔄 TRAITEMENT ET STOCKAGE
    if (!dryRun && allActivities.length > 0) {
      console.log('🔄 Traitement et stockage des activités...');
      
      // Trier par date décroissante pour traiter les plus récentes en premier
      allActivities.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
      
      for (let i = 0; i < allActivities.length; i++) {
        const activity = allActivities[i];
        
        try {
          // Traiter l'activité (stockage + détails si course)
          await fetchAndProcessActivity(activity.id, userId);
          report.activities_processed++;
          
          // Check si c'est une course qui aura des détails
          if (activity.type === 'Run' && activity.distance > 1000) {
            report.activities_with_details++;
          }
          
          // Log de progression
          if ((i + 1) % 50 === 0) {
            console.log(`📊 Progression: ${i + 1}/${allActivities.length} activités traitées`);
          }
          
          // Délai pour éviter de surcharger
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          // Vérifier le temps d'exécution pour éviter les timeouts
          if (Date.now() - startTime > 25000) { // 25 secondes max
            console.log('⏰ Timeout approché, arrêt du traitement');
            break;
          }
          
        } catch (error) {
          const errorMsg = `Erreur activité ${activity.id}: ${error instanceof Error ? error.message : 'Unknown'}`;
          report.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    }
    
    report.execution_time_ms = Date.now() - startTime;
    
    // 4. 📋 STATISTIQUES FINALES
    let finalStats = null;
    
    if (!dryRun && report.activities_processed > 0) {
      try {
        // Statistiques de la base reconstruite
        const totalActivities = await redis.llen('activities:ids');
        const lastActivityTimestamp = await redis.get('activities:last_activity');
        
        finalStats = {
          total_in_database: totalActivities,
          last_activity_date: lastActivityTimestamp ? new Date(parseInt(lastActivityTimestamp)).toISOString() : null,
          activities_per_minute: Math.round(report.activities_processed / (report.execution_time_ms / 60000))
        };
      } catch (e) {
        finalStats = { error: 'Could not get final stats' };
      }
    }
    
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      rebuild_report: report,
      sample_activities: dryRun ? allActivities.slice(0, 5).map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        start_date: a.start_date,
        distance_km: Math.round(a.distance / 10) / 100
      })) : null,
      final_database_stats: finalStats,
      next_steps: !dryRun && report.activities_processed > 0 ? [
        'Base de données reconstruite avec succès',
        'Tester: curl "http://localhost:3000/api/gpt/activities?days=28"',
        'Configurer les webhooks pour les futures activités'
      ] : null
    });
    
  } catch (error) {
    console.error('❌ Erreur rebuild:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
