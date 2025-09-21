// app/api/gpt/activities/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('user_id') || '14060676');
  const days = parseInt(searchParams.get('days') || '28');
  const autoSync = searchParams.get('auto_sync') !== 'false'; // true par défaut
  
  try {
    console.log(`🤖 GPT request: ${days} derniers jours pour user ${userId} (auto_sync: ${autoSync})`);
    
    // 1. Sync intelligent si demandé
    if (autoSync) {
      try {
        const syncResponse = await fetch(`${request.nextUrl.origin}/api/sync/smart-sync?user_id=${userId}`, {
          method: 'POST'
        });
        
        if (syncResponse.ok) {
          const syncResult = await syncResponse.json();
          console.log(`🔄 Auto-sync: ${syncResult.sync_report.processed} nouvelles activités`);
        }
      } catch (syncError) {
        console.warn('⚠️ Auto-sync failed:', syncError);
        // Continuer même si sync échoue
      }
    }
    
    // 2. Calculer la date limite
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTimestamp = cutoffDate.getTime();
    
    // 3. Récupérer les IDs d'activités
    const activityIds = await redis.lrange('activities:ids', 0, 100); // Limite raisonnable
    
    // 4. Récupérer et filtrer les activités
    const activities = [];
    
    for (const activityId of activityIds) {
      const activityKey = `activity:${activityId}`;
      const activityData = await redis.get(activityKey);
      
      if (activityData) {
        const activity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
        
        // Filtrer par date
        const activityDate = new Date(activity.start_date || activity.date);
        if (activityDate.getTime() >= cutoffTimestamp) {
          
          // Format optimisé pour GPT
          activities.push({
            id: activity.id,
            name: activity.name,
            type: activity.type,
            date: activity.start_date,
            distance_km: Math.round((activity.distance || 0) / 100) / 10, // en km avec 1 décimale
            duration_min: Math.round((activity.moving_time || activity.elapsed_time || 0) / 60),
            elevation_m: Math.round(activity.total_elevation_gain || 0),
            average_hr: activity.average_heartrate,
            max_hr: activity.max_heartrate,
            average_power: activity.average_watts,
            calories: activity.calories,
            suffer_score: activity.suffer_score,
            commute: activity.commute || false,
            trainer: activity.trainer || false,
            achievement_count: activity.achievement_count || 0
          });
        }
      }
      
      // Arrêter si on a assez d'activités dans la période
      if (activities.length >= 50) break;
    }
    
    // 5. Trier par date décroissante
    activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // 6. Statistiques utiles pour GPT
    const stats = {
      total_activities: activities.length,
      period_days: days,
      activity_types: [...new Set(activities.map(a => a.type))],
      total_distance_km: Math.round(activities.reduce((sum, a) => sum + (a.distance_km || 0), 0) * 10) / 10,
      total_duration_hours: Math.round(activities.reduce((sum, a) => sum + (a.duration_min || 0), 0) / 60 * 10) / 10,
      avg_activities_per_week: Math.round((activities.length / days * 7) * 10) / 10
    };
    
    return NextResponse.json({
      success: true,
      period: {
        days: days,
        start_date: cutoffDate.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0]
      },
      stats: stats,
      activities: activities.slice(0, days === 28 ? 28 : 50) // Limiter selon la demande
    });
    
  } catch (error) {
    console.error('❌ Erreur GPT activities:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
