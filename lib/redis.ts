// lib/redis.ts

import { Redis } from '@upstash/redis';
import { StravaWebhookEvent, StravaTokens, StravaActivityDetails } from '@/types/strava';

const redis = Redis.fromEnv();

// Export nommé obligatoire
export async function storeEventInRedis(eventData: StravaWebhookEvent): Promise<void> {
  const key = `strava_event:${eventData.object_id}:${eventData.event_time}`;
  
  await redis.setex(key, 3600, JSON.stringify(eventData)); // Expire après 1h
  
  // Ajouter à une queue pour traitement
  await redis.lpush('strava_events_queue', JSON.stringify(eventData));
  
  console.log('Événement stocké dans Redis:', key);
}

// Export nommé obligatoire
export async function getStoredUserToken(userId: number): Promise<StravaTokens | null> {
  try {
    const tokenData = await redis.get(`user_token:${userId}`);
    
    console.log('🔍 Raw token data from Redis:', {
      type: typeof tokenData,
      value: tokenData,
      isNull: tokenData === null,
      isUndefined: tokenData === undefined
    });
    
    if (!tokenData) {
      console.log(`❌ Aucun token trouvé pour l'utilisateur ${userId}`);
      return null;
    }
    
    // Si c'est une chaîne, parser en JSON
    if (typeof tokenData === 'string') {
      try {
        return JSON.parse(tokenData);
      } catch (parseError) {
        console.error('❌ Erreur parsing JSON:', parseError);
        console.log('Raw string data:', tokenData);
        return null;
      }
    }
    
    // Si c'est déjà un objet, le retourner tel quel
    if (typeof tokenData === 'object' && tokenData !== null) {
      return tokenData as StravaTokens;
    }
    
    console.error('❌ Type de données inattendu:', typeof tokenData);
    return null;
    
  } catch (error) {
    console.error('❌ Erreur Redis dans getStoredUserToken:', error);
    return null;
  }
}

// Export nommé obligatoire
export async function storeUserToken(userId: number, tokenData: StravaTokens): Promise<void> {
  try {
    await redis.set(`user_token:${userId}`, JSON.stringify(tokenData));
    console.log(`💾 Token stocké pour l'utilisateur ${userId}`);
  } catch (error) {
    console.error('❌ Erreur lors du stockage du token:', error);
    throw error;
  }
}

// ⭐ Nouvelles fonctions pour les détails d'activités
export async function storeActivityDetails(activityId: number, details: StravaActivityDetails): Promise<void> {
  try {
    const key = `activity_details:${activityId}`;
    
    await redis.setex(key, 30 * 24 * 60 * 60, JSON.stringify(details)); // 30 jours
    console.log(`💾 Détails stockés pour l'activité: ${key}`);
  } catch (error) {
    console.error('❌ Erreur lors du stockage des détails:', error);
    throw error;
  }
}

export async function getActivityDetails(activityId: number): Promise<StravaActivityDetails | null> {
  try {
    const key = `activity_details:${activityId}`;
    const detailsData = await redis.get(key);
    
    if (!detailsData) {
      return null;
    }
    
    return typeof detailsData === 'string' 
      ? JSON.parse(detailsData) 
      : detailsData as StravaActivityDetails;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des détails:', error);
    return null;
  }
}

export async function hasActivityDetails(activityId: number): Promise<boolean> {
  try {
    const key = `activity_details:${activityId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    console.error('❌ Erreur lors de la vérification des détails:', error);
    return false;
  }
}

// Export par défaut
export default redis;
