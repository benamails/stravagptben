// lib/activity-processor.ts

import { StravaClient } from './strava-client';
import { getStoredUserToken, storeUserToken, storeActivityDetails } from './redis';
import { StravaActivity, StravaTokens, StravaActivityDetails } from '@/types/strava';

// Interface pour le format de données souhaité
interface FormattedActivity {
  date: string;
  type: string;
  avg_hr: number | null;
  charge: number | null;
  commute: boolean;
  avg_watts: string | null;
  elevation: number;
  intensity: number | null;
  upload_id: number;
  activity_id: number;
  avg_cadence: number | null;
  time_moving: number;
  suffer_score: number | null;
  time_elapsed: number;
  distance_meter: number;
  userId: number; // ⭐ Ajout du userId pour les requêtes
}

export async function fetchAndProcessActivity(activityId: number, ownerId: number): Promise<void> {
  try {
    // Récupérer les tokens de l'utilisateur depuis Redis
    let tokenData = await getStoredUserToken(ownerId);
    
    if (!tokenData) {
      console.log(`❌ Aucun token trouvé pour l'utilisateur ${ownerId}`);
      return;
    }
    
    // Vérifier si le token doit être rafraîchi
    if (isTokenExpired(tokenData)) {
      console.log(`🔄 Token expiré pour l'utilisateur ${ownerId}, rafraîchissement...`);
      tokenData = await refreshUserToken(ownerId, tokenData.refresh_token);
    }
    
    // Créer le client Strava
    const stravaClient = new StravaClient(tokenData.access_token);
    
    // Récupérer les détails de l'activité
    const activity = await stravaClient.fetchActivity(activityId);
    
    console.log('✅ Activité récupérée:', {
      id: activity.id,
      name: activity.name,
      type: activity.type
    });
    
    // Traiter l'activité selon tes besoins
    await processActivity(activity, ownerId);
    
  } catch (error) {
    console.error('❌ Erreur lors du traitement de l\'activité:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        console.error('🔐 Erreur d\'authentification - token invalide ou expiré');
      } else if (error.message.includes('403')) {
        console.error('🚫 Accès interdit - vérifier les permissions');
      } else if (error.message.includes('404')) {
        console.error('🔍 Activité non trouvée ou supprimée');
      } else if (error.message.includes('429')) {
        console.error('⏱️ Rate limit atteint - trop de requêtes');
      }
    }
  }
}

async function processActivity(activity: StravaActivity, ownerId: number): Promise<void> {
  try {
    console.log(`🔄 Traitement de l'activité ${activity.id} pour l'utilisateur ${ownerId}`);
    
    // Formatter les données dans le format souhaité
    const formattedActivity: FormattedActivity = formatActivityData(activity, ownerId);
    
    console.log('📋 Données formatées:', formattedActivity);
    
    // Stocker l'activité formatée
    await storeFormattedActivity(formattedActivity, ownerId);
    
    // ⭐ NOUVEAU : Récupérer les détails pour les activités de course
    if (StravaClient.shouldFetchDetails(activity)) {
      console.log(`🏃 Récupération des détails pour l'activité de type ${activity.type}`);
      await fetchAndStoreActivityDetails(activity.id, ownerId);
    }
    
    console.log(`✅ Activité ${activity.id} traitée avec succès`);
    
  } catch (error) {
    console.error(`❌ Erreur lors du traitement de l'activité ${activity.id}:`, error);
    throw error;
  }
}

// ⭐ Nouvelle fonction pour récupérer et stocker les détails
async function fetchAndStoreActivityDetails(activityId: number, ownerId: number): Promise<void> {
  try {
    // Récupérer le token utilisateur
    let tokenData = await getStoredUserToken(ownerId);
    
    if (!tokenData) {
      console.log(`❌ Pas de token pour récupérer les détails de l'activité ${activityId}`);
      return;
    }
    
    // Vérifier expiration du token
    if (isTokenExpired(tokenData)) {
      tokenData = await refreshUserToken(ownerId, tokenData.refresh_token);
    }
    
    // Créer le client et récupérer les détails
    const stravaClient = new StravaClient(tokenData.access_token);
    const details = await stravaClient.fetchActivityDetails(activityId);
    
    // Stocker les détails dans Redis
    await storeActivityDetails(activityId, details);
    
    console.log(`📊 Détails stockés pour l'activité ${activityId}`);
    
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération des détails pour l'activité ${activityId}:`, error);
    // Ne pas faire échouer tout le processus pour les détails
  }
}

function isTokenExpired(tokenData: StravaTokens): boolean {
  const now = Math.floor(Date.now() / 1000);
  const bufferTime = 300; // 5 minutes de marge
  return now >= (tokenData.expires_at - bufferTime);
}

async function refreshUserToken(userId: number, refreshToken: string): Promise<StravaTokens> {
  try {
    const stravaClient = new StravaClient(''); // Token vide pour le refresh
    const newTokenData = await stravaClient.refreshToken(refreshToken);
    
    const tokens: StravaTokens = {
      access_token: newTokenData.access_token,
      refresh_token: newTokenData.refresh_token,
      expires_at: newTokenData.expires_at,
      token_type: newTokenData.token_type
    };
    
    // Stocker les nouveaux tokens
    await storeUserToken(userId, tokens);
    console.log(`✅ Token rafraîchi pour l'utilisateur ${userId}`);
    
    return tokens;
  } catch (error) {
    console.error(`❌ Erreur lors du refresh token pour l'utilisateur ${userId}:`, error);
    throw new Error(`Impossible de rafraîchir le token: ${error}`);
  }
}

function formatActivityData(activity: StravaActivity, userId: number): FormattedActivity {
  // Calculer la charge (Training Stress Score approximatif)
  const charge = calculateCharge(activity);
  
  // Calculer l'intensité
  const intensity = calculateIntensity(activity);
  
  return {
    date: activity.start_date,
    type: activity.type,
    avg_hr: activity.average_heartrate || null,
    charge: charge,
    commute: (activity as any).commute || false, // Strava a ce champ
    avg_watts: activity.average_watts ? activity.average_watts.toString() : null,
    elevation: Math.round(activity.total_elevation_gain || 0),
    intensity: intensity,
    upload_id: (activity as any).upload_id || 0, // Strava a ce champ
    activity_id: activity.id,
    avg_cadence: (activity as any).average_cadence || null, // Strava a ce champ
    time_moving: activity.moving_time,
    suffer_score: (activity as any).suffer_score || null, // Strava a ce champ
    time_elapsed: activity.elapsed_time,
    distance_meter: Math.round(activity.distance),
    userId: userId // ⭐ Ajout du userId
  };
}

function calculateCharge(activity: StravaActivity): number | null {
  // Calcul de la charge basé sur HR et durée
  if (!activity.average_heartrate || !activity.moving_time) {
    return null;
  }
  
  // Formule approximative : (HR moyenne / HR max estimée) * durée en minutes * facteur
  const estimatedMaxHR = 220 - 35; // Estimation pour un athlète de 35 ans, à ajuster
  const hrIntensity = activity.average_heartrate / estimatedMaxHR;
  const durationMinutes = activity.moving_time / 60;
  const charge = hrIntensity * durationMinutes * 1.2; // Facteur d'ajustement
  
  return Math.round(charge * 100) / 100;
}

function calculateIntensity(activity: StravaActivity): number | null {
  // Calcul de l'intensité basé sur la vitesse et la FC
  if (!activity.average_heartrate) {
    return null;
  }
  
  // Intensité basée sur le ratio FC/vitesse
  const speed = activity.average_speed || 1;
  const intensity = (activity.average_heartrate * speed) / 100;
  
  return Math.round(intensity * 1000) / 1000;
}

async function storeFormattedActivity(activityData: FormattedActivity, ownerId: number): Promise<void> {
  try {
    // ⭐ Nouvelle structure : activity:{id}
    const key = `activity:${activityData.activity_id}`;
    
    const { default: redis } = await import('./redis');
    
    // Stocker l'activité formatée avec expiration de 30 jours
    await redis.setex(key, 30 * 24 * 60 * 60, JSON.stringify(activityData));
    
    // ⭐ Optionnel : garder aussi une liste par utilisateur pour faciliter les requêtes
    const userActivitiesKey = `user:${ownerId}:activities`;
    await redis.lpush(userActivitiesKey, activityData.activity_id.toString());
    
    // Garder seulement les 100 dernières activités par utilisateur
    await redis.ltrim(userActivitiesKey, 0, 99);
    
    console.log(`💾 Activité stockée: ${key}`);
    
  } catch (error) {
    console.error('❌ Erreur lors du stockage de l\'activité formatée:', error);
    throw error;
  }
}

// Fonction utilitaire pour récupérer les activités formatées
export async function getUserFormattedActivities(userId: number, limit: number = 10): Promise<FormattedActivity[]> {
  try {
    const { default: redis } = await import('./redis');
    
    // Récupérer la liste des IDs d'activités de l'utilisateur
    const userActivitiesKey = `user:${userId}:activities`;
    const activityIds = await redis.lrange(userActivitiesKey, 0, limit - 1);
    
    // Récupérer les données complètes de chaque activité
    const activities: FormattedActivity[] = [];
    
    for (const activityId of activityIds) {
      const activityKey = `activity:${activityId}`;
      const activityData = await redis.get(activityKey);
      
      if (activityData) {
        const parsedActivity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
        activities.push(parsedActivity);
      }
    }
    
    return activities;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des activités formatées:', error);
    return [];
  }
}
