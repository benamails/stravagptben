// app/api/sync/smart-sync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { StravaClient } from '@/lib/strava-client';
import { getStoredUserToken } from '@/lib/redis';
import { fetchAndProcessActivity } from '@/lib/activity-processor';

// ⭐ Fonction utilitaire pour gérer les types Redis
function parseRedisTimestamp(value: any): number | null {
  if (!value) return null;
  
  const timestampStr = typeof value === 'string' ? value : value.toString();
  const parsed = parseInt(timestampStr);
  
  return isNaN(parsed) ? null : parsed;
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('user_id') || '14060676');
  
  try {
    console.log(`🧠 Smart sync pour utilisateur ${userId}`);
    
    const { default: redis } = await import('@/lib/redis');
    
    // 1. Récupérer la dernière activité connue
    const lastActivityTimestamp = await redis.get('activities:last_activity');
    const lastTimestamp = parseRedisTimestamp(lastActivityTimestamp);
    
    let afterTimestamp: number;
    if (lastTimestamp) {
      afterTimestamp = Math.floor(lastTimestamp / 1000);
      console.log(`📅 Dernière sync: ${new Date(lastTimestamp).toISOString()}`);
    } else {
      // Pas de dernière activité, prendre les 7 derniers jours
      afterTimestamp = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
      console.log('🆕 Première sync: 7 derniers jours');
    }
    
    // 2. Récupérer le token
    const tokenData = await getStoredUserToken(userId);
    if (!tokenData) {
      return NextResponse.json({ success: false, error: 'Token not found' }, { status: 404 });
    }
    
    // 3. Appel API Strava pour les activités récentes
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${afterTimestamp}&per_page=50`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Strava API error: ${response.status}`);
    }
    
    const recentActivities = await response.json();
    
    // 4. Filtrer les nouvelles activités
    const existingIds = await redis.lrange('activities:ids', 0, -1);
    const existingSet = new Set(existingIds);
    
    const newActivities = recentActivities.filter((activity: any) => 
      !existingSet.has(activity.id.toString())
    );
    
    console.log(`📊 ${recentActivities.length} activités récentes, ${newActivities.length} nouvelles`);
    
    // 5. Traiter les nouvelles activités
    let processed = 0;
    const errors: string[] = [];
    
    for (const activity of newActivities) {
      try {
        await fetchAndProcessActivity(activity.id, userId);
        processed++;
        console.log(`✅ Processé: ${activity.name} (${activity.type})`);
      } catch (error) {
        const errorMsg = `${activity.id}: ${error instanceof Error ? error.message : 'Unknown'}`;
        errors.push(errorMsg);
      }
    }
    
    return NextResponse.json({
      success: true,
      sync_report: {
        total_checked: recentActivities.length,
        new_found: newActivities.length,
        processed: processed,
        errors: errors.length,
        error_details: errors,
        last_sync_before: lastTimestamp ? new Date(lastTimestamp).toISOString() : 'never',
        last_sync_after: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur smart sync:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
