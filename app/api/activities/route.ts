// app/api/activities/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis, { getActivityDetails, hasActivityDetails } from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const userId = searchParams.get('user_id');
    const includeDetails = searchParams.get('include_details') === 'true';
    const type = searchParams.get('type');
    
    console.log(`📋 Récupération des activités (limit: ${limit}, user: ${userId}, details: ${includeDetails}, type: ${type})`);
    
    let activities = [];
    
    if (userId) {
      // Récupération par utilisateur spécifique (plus efficace)
      activities = await getActivitiesByUser(parseInt(userId), limit, type);
    } else {
      // Récupération globale de toutes les activités avec SCAN
      activities = await getAllActivitiesWithScan(limit, type);
    }
    
    // Enrichir avec les détails si demandé
    if (includeDetails) {
      activities = await enrichActivitiesWithDetails(activities);
    }
    
    // Trier par date (plus récent en premier)
    const sortedActivities = activities.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    return NextResponse.json({
      success: true,
      count: sortedActivities.length,
      filters: {
        user_id: userId,
        type: type,
        limit: limit,
        include_details: includeDetails
      },
      activities: sortedActivities
    });
  } catch (error) {
    console.error('❌ Erreur récupération activités:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}

// Fonction pour récupérer les activités d'un utilisateur spécifique (EFFICACE)
async function getActivitiesByUser(userId: number, limit: number, typeFilter?: string | null): Promise<any[]> {
  try {
    // ⭐ Utiliser la liste d'activités de l'utilisateur (plus efficace)
    const userActivitiesKey = `user:${userId}:activities`;
    const activityIds = await redis.lrange(userActivitiesKey, 0, limit * 2);
    
    const activities = [];
    
    for (const activityId of activityIds) {
      const activityKey = `activity:${activityId}`;
      const activityData = await redis.get(activityKey);
      
      if (activityData) {
        const parsedActivity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
        
        // Filtrer par type si spécifié
        if (!typeFilter || parsedActivity.type === typeFilter) {
          parsedActivity.has_details = await hasActivityDetails(parseInt(activityId));
          activities.push(parsedActivity);
          
          if (activities.length >= limit) {
            break;
          }
        }
      }
    }
    
    return activities;
  } catch (error) {
    console.error('❌ Erreur récupération activités utilisateur:', error);
    return [];
  }
}

// ⭐ NOUVELLE FONCTION : Utiliser SCAN au lieu de KEYS
async function getAllActivitiesWithScan(limit: number, typeFilter?: string | null): Promise<any[]> {
  try {
    const activities = [];
    let cursor = 0;
    let scanCount = 0;
    const maxScans = 10; // Limiter le nombre de scans pour éviter les timeouts
    
    do {
      // Utiliser SCAN au lieu de KEYS
      const result = await redis.scan(cursor, {
        match: 'activity:*',
        count: 50 // Récupérer 50 clés par scan
      });
      
      cursor = result[0];
      const keys = result[1];
      
      // Traiter les clés trouvées
      for (const key of keys) {
        if (activities.length >= limit) {
          break;
        }
        
        const activityData = await redis.get(key);
        
        if (activityData) {
          const parsedActivity = typeof activityData === 'string' 
            ? JSON.parse(activityData) 
            : activityData;
          
          // Filtrer par type si spécifié
          if (!typeFilter || parsedActivity.type === typeFilter) {
            // Extraire l'ID de l'activité depuis la clé
            const activityId = key.split(':')[1];
            parsedActivity.has_details = await hasActivityDetails(parseInt(activityId));
            activities.push(parsedActivity);
          }
        }
      }
      
      scanCount++;
      
      // Arrêter si on a trouvé assez d'activités ou atteint la limite de scans
      if (activities.length >= limit || scanCount >= maxScans) {
        break;
      }
      
    } while (cursor !== 0);
    
    console.log(`📊 SCAN terminé: ${activities.length} activités trouvées en ${scanCount} scans`);
    return activities;
    
  } catch (error) {
    console.error('❌ Erreur scan activités:', error);
    return [];
  }
}

// Fonction pour enrichir les activités avec leurs détails
async function enrichActivitiesWithDetails(activities: any[]): Promise<any[]> {
  try {
    const enrichedActivities = [];
    
    for (const activity of activities) {
      const enrichedActivity = { ...activity };
      
      // Ajouter les détails si disponibles et si c'est une activité qui en mérite
      if (activity.has_details && (activity.type === 'Run' || activity.type === 'Ride')) {
        const details = await getActivityDetails(activity.activity_id);
        if (details) {
          enrichedActivity.details = details;
          console.log(`📊 Détails ajoutés pour l'activité ${activity.activity_id}`);
        }
      }
      
      enrichedActivities.push(enrichedActivity);
    }
    
    return enrichedActivities;
  } catch (error) {
    console.error('❌ Erreur enrichissement activités:', error);
    return activities;
  }
}

export const dynamic = 'force-dynamic';
