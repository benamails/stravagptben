// app/api/activities/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const userId = searchParams.get('user_id');
    
    // ⭐ Récupérer toutes les activités
    const allActivityKeys = await redis.keys('activity:*');
    
    const activities = [];
    
    for (const key of allActivityKeys.slice(0, limit * 2)) {
      const activityData = await redis.get(key);
      
      if (activityData) {
        const parsedActivity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
          
        // Filtrer par userId si spécifié
        if (!userId || parsedActivity.userId.toString() === userId) {
          activities.push(parsedActivity);
        }
        
        if (activities.length >= limit) break;
      }
    }
    
    // Trier par date (plus récent en premier)
    const sortedActivities = activities.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    return NextResponse.json({
      success: true,
      count: sortedActivities.length,
      activities: sortedActivities
    });
  } catch (error) {
    console.error('Erreur récupération activités:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
