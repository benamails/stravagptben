// app/api/gpt/activities/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getUserRawActivities, getActivityDate, isActivityRecent } from '@/lib/activity-processor';
import { getActivityDetails, hasActivityDetails } from '@/lib/redis';

type FlexibleStravaActivity = StravaActivity & {
  [key: string]: any;
};
const activity = allActivities[i] as FlexibleStravaActivity;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('user_id') || '14060676');
  const days = parseInt(searchParams.get('days') || '28');
  const autoSync = searchParams.get('auto_sync') !== 'false'; // true par défaut
  const includeDetails = searchParams.get('include_details') === 'true'; // false par défaut
  
  try {
    console.log(`🤖 GPT request: ${days} derniers jours pour user ${userId} (auto_sync: ${autoSync})`);
    
    let syncReport = null;
    
    // 1. ⭐ AUTO-SYNC : Synchroniser les nouvelles activités automatiquement
    if (autoSync) {
      try {
        const syncResponse = await fetch(`${request.nextUrl.origin}/api/sync/smart-sync?user_id=${userId}`, {
          method: 'POST'
        });
        
        if (syncResponse.ok) {
          syncReport = await syncResponse.json();
          console.log(`🔄 Auto-sync: ${syncReport.sync_report?.processed || 0} nouvelles activités`);
        }
      } catch (syncError) {
        console.warn('⚠️ Auto-sync failed:', syncError);
        // Continuer même si sync échoue
      }
    }
    
    // 2. Calculer la date limite (28 derniers jours par défaut)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTimestamp = cutoffDate.getTime();
    
    console.log(`📅 Période d'analyse: depuis ${cutoffDate.toISOString().split('T')[0]} (${days} jours)`);
    
    // 3. Récupérer plus d'activités pour filtrer par date
    const allActivities = await getUserRawActivities(userId, days * 2); // Plus pour être sûr
    
    // 4. Filtrer par période et enrichir les données
    const activities = [];
    
    for (const activity of allActivities) {
      // Récupérer la date de l'activité
      const activityDate = getActivityDate(activity);
      
      if (activityDate) {
        const activityTimestamp = new Date(activityDate).getTime();
        
        // Filtrer par période
        if (activityTimestamp >= cutoffTimestamp) {
          
          // ⭐ FORMAT OPTIMISÉ POUR GPT
          const gptActivity = {
            // Identification
            id: activity.id,
            name: activity.name || 'Activité sans nom',
            type: activity.type,
            
            // Date et durée
            date: activityDate,
            date_local: activity.start_date_local || activityDate,
            duration_seconds: activity.moving_time || activity.elapsed_time || 0,
            duration_minutes: Math.round((activity.moving_time || activity.elapsed_time || 0) / 60),
            
            // Distance et élévation
            distance_meters: activity.distance || 0,
            distance_km: Math.round((activity.distance || 0) / 100) / 10, // 1 décimale
            elevation_gain_meters: Math.round(activity.total_elevation_gain || 0),
            
            // Performance
            average_speed_kmh: activity.average_speed ? Math.round(activity.average_speed * 3.6 * 10) / 10 : null,
            max_speed_kmh: activity.max_speed ? Math.round(activity.max_speed * 3.6 * 10) / 10 : null,
            average_heartrate: activity.average_heartrate || null,
            max_heartrate: activity.max_heartrate || null,
            average_power: activity.average_watts || null,
            max_power: activity.max_watts || null,
            average_cadence: activity.average_cadence || null,
            
            // Calories et effort
            calories: activity.calories || null,
            suffer_score: activity.suffer_score || null,
            
            // Contexte
            commute: activity.commute || false,
            trainer: activity.trainer || false,
            manual: activity.manual || false,
            
            // Achievements et kudos
            achievement_count: activity.achievement_count || 0,
            kudos_count: activity.kudos_count || 0,
            
            // Météo (si disponible)
            temperature: activity.average_temp || null,
            
            // Flag pour savoir si des détails sont disponibles
            has_details: false
          };
          
          // ⭐ Ajouter les détails si demandés et disponibles
          if (includeDetails) {
            const hasDetails = await hasActivityDetails(activity.id);
            gptActivity.has_details = hasDetails;
            
            if (hasDetails) {
              const details = await getActivityDetails(activity.id);
              if (details) {
                (gptActivity as any).details = {
                  splits_km: details.splits_metric?.slice(0, 10), // Max 10 premiers km
                  laps: details.laps?.slice(0, 5), // Max 5 premiers tours
                  segment_efforts_count: details.segment_efforts?.length || 0
                };
              }
            }
          } else {
            // Juste vérifier si des détails existent
            gptActivity.has_details = await hasActivityDetails(activity.id);
          }
          
          activities.push(gptActivity);
        }
      }
      
      // Arrêter si on a assez d'activités dans la période
      if (activities.length >= 50) break;
    }
    
    // 5. Trier par date décroissante (plus récent en premier)
    activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // 6. ⭐ STATISTIQUES UTILES POUR L'ANALYSE GPT
    const stats = {
      // Période analysée
      period_days: days,
      period_start: cutoffDate.toISOString().split('T')[0],
      period_end: new Date().toISOString().split('T')[0],
      
      // Compteurs généraux
      total_activities: activities.length,
      activity_types: [...new Set(activities.map(a => a.type))],
      
      // Volumes totaux
      total_distance_km: Math.round(activities.reduce((sum, a) => sum + (a.distance_km || 0), 0) * 10) / 10,
      total_duration_hours: Math.round(activities.reduce((sum, a) => sum + (a.duration_minutes || 0), 0) / 60 * 10) / 10,
      total_elevation_meters: activities.reduce((sum, a) => sum + (a.elevation_gain_meters || 0), 0),
      
      // Moyennes par semaine
      avg_activities_per_week: Math.round((activities.length / days * 7) * 10) / 10,
      avg_distance_per_week_km: Math.round((activities.reduce((sum, a) => sum + (a.distance_km || 0), 0) / days * 7) * 10) / 10,
      avg_duration_per_week_hours: Math.round((activities.reduce((sum, a) => sum + (a.duration_minutes || 0), 0) / 60 / days * 7) * 10) / 10,
      
      // Répartition par type
      activities_by_type: activities.reduce((acc: any, activity) => {
        acc[activity.type] = (acc[activity.type] || 0) + 1;
        return acc;
      }, {}),
      
      // Performance moyenne (courses uniquement)
      running_stats: (() => {
        const runs = activities.filter(a => a.type === 'Run' && a.distance_km > 0);
        if (runs.length === 0) return null;
        
        return {
          total_runs: runs.length,
          total_distance_km: Math.round(runs.reduce((sum, r) => sum + (r.distance_km || 0), 0) * 10) / 10,
          avg_pace_min_per_km: runs.length > 0 ? 
            Math.round(runs.reduce((sum, r) => sum + (r.duration_minutes || 0) / (r.distance_km || 1), 0) / runs.length * 10) / 10 : null,
          avg_distance_per_run_km: Math.round(runs.reduce((sum, r) => sum + (r.distance_km || 0), 0) / runs.length * 10) / 10
        };
      })()
    };
    
    return NextResponse.json({
      success: true,
      
      // Métadonnées de la requête
      request_info: {
        user_id: userId,
        period_days: days,
        auto_sync_enabled: autoSync,
        include_details: includeDetails,
        generated_at: new Date().toISOString()
      },
      
      // Rapport de synchronisation (si effectuée)
      sync_report: syncReport?.sync_report || null,
      
      // Statistiques pour l'analyse GPT
      stats: stats,
      
      // Activités détaillées
      activities: activities,
      
      // Message d'aide pour GPT
      gpt_context: {
        description: `Données d'activités Strava des ${days} derniers jours`,
        tips: [
          "Les distances sont en km avec 1 décimale",
          "Les durées sont en minutes",
          "Les vitesses sont en km/h",
          "suffer_score = effort perçu Strava",
          "has_details = true si segments/splits disponibles"
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur endpoint GPT:', error);
    return NextResponse.json({
      success: false,
      error: 'Server error',
      message: 'Erreur lors de la récupération des activités'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
