// app/api/debug/user-activities/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id') || '14060676';
  
  try {
    // 1. Vérifier la liste d'activités de l'utilisateur
    const userActivitiesKey = `user:${userId}:activities`;
    const activityIds = await redis.lrange(userActivitiesKey, 0, -1); // Toutes les activités
    
    console.log(`Debug pour utilisateur ${userId}:`);
    console.log('Activity IDs:', activityIds);
    
    // 2. Récupérer les détails de quelques activités
    const activitiesDetail = [];
    
    for (const activityId of activityIds.slice(0, 5)) { // Seulement les 5 premières
      const activityKey = `activity:${activityId}`;
      const activityData = await redis.get(activityKey);
      
      if (activityData) {
        const parsedActivity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
        activitiesDetail.push({
          id: activityId,
          key: activityKey,
          type: parsedActivity.type,
          date: parsedActivity.date,
          raw_data_preview: JSON.stringify(parsedActivity).substring(0, 200) + '...'
        });
      } else {
        activitiesDetail.push({
          id: activityId,
          key: activityKey,
          error: 'Data not found'
        });
      }
    }
    
    // 3. Scanner quelques clés activity:* directement
    const allActivityKeys = [];
    try {
      const scanResult = await redis.scan("0", {
        match: 'activity:*',
        count: 10
      });
      allActivityKeys.push(...scanResult[1]);
    } catch (scanError) {
      console.error('Scan error:', scanError);
    }
    
    return NextResponse.json({
      debug: {
        userId: userId,
        userActivitiesKey: userActivitiesKey,
        activityIds: activityIds,
        activityCount: activityIds.length,
        activitiesDetail: activitiesDetail,
        sampleActivityKeys: allActivityKeys,
        message: activityIds.length === 0 ? 'No activities found for user' : 'Activities found'
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({
      error: 'Debug failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
