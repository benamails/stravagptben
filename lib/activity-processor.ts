// lib/activity-processor.ts

import { StravaClient } from './strava-client';
import { getStoredUserToken, storeUserToken, storeActivityDetails } from './redis';
import { StravaActivity, StravaTokens, StravaActivityDetails } from '@/types/strava';

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
    
    // ⭐ Stocker l'activité brute avec tracking
    await storeRawActivity(activity, ownerId);
    
    // ⭐ Récupérer les détails pour les activités de course
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

// ⭐ Stocker l'activité brute avec tracking timestamp
async function storeRawActivity(activity: StravaActivity, ownerId: number): Promise<void> {
  try {
    // Ajouter quelques métadonnées utiles
    const enrichedActivity = {
      ...activity,
      userId: ownerId, // Ajouter l'userId pour les filtres
      processed_at: new Date().toISOString(),
      owner_id: ownerId // Pour compatibilité
    };
    
    // Stocker avec la nouvelle structure (sans :raw maintenant)
    const key = `activity:${activity.id}`;
    
    const { default: redis } = await import('./redis');
    
    // Stocker l'activité brute avec expiration de 90 jours
    await redis.setex(key, 90 * 24 * 60 * 60, JSON.stringify(enrichedActivity));
    
    // ⭐ Ajouter à la liste globale
    await redis.lpush('activities:ids', activity.id.toString());
    
    // Garder seulement les 500 dernières activités dans la liste
    await redis.ltrim('activities:ids', 0, 499);
    
    // ⭐ Tracker la dernière activité
    await updateLastActivityTimestamp(activity.start_date);
    
    console.log(`💾 Activité brute stockée: ${key}`);
    
  } catch (error) {
    console.error('❌ Erreur lors du stockage de l\'activité brute:', error);
    throw error;
  }
}

// ⭐ Mettre à jour le timestamp de dernière activité
async function updateLastActivityTimestamp(activityDate: string): Promise<void> {
  try {
    const { default: redis } = await import('./redis');
    const timestamp = new Date(activityDate).getTime();
    
    // Récupérer l'ancien timestamp
    const currentTimestamp = await redis.get('activities:last_activity');
    
    // Mettre à jour seulement si plus récent
    if (!currentTimestamp || timestamp > parseInt(currentTimestamp.toString())) {
      await redis.set('activities:last_activity', timestamp.toString());
      console.log(`📅 Dernière activité mise à jour: ${activityDate}`);
    }
  } catch (error) {
    console.error('❌ Erreur mise à jour timestamp:', error);
  }
}

// Fonction pour récupérer et stocker les détails
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

// ⭐ FONCTION INTELLIGENTE : Récupérer les activités brutes avec gestion multi-format des dates
export async function getUserRawActivities(userId: number, limit: number = 10): Promise<StravaActivity[]> {
  try {
    const { default: redis } = await import('./redis');
    
    // Récupérer la liste des IDs d'activités depuis la liste globale
    const activityIds = await redis.lrange('activities:ids', 0, limit * 3); // Plus pour filtrer
    
    console.log(`📋 Récupération de ${activityIds.length} IDs d'activités`);
    
    // Récupérer les données complètes de chaque activité
    const activities: StravaActivity[] = [];
    
    for (const activityId of activityIds) {
      const activityKey = `activity:${activityId}`;
      const activityData = await redis.get(activityKey);
      
      if (activityData) {
        const parsedActivity = typeof activityData === 'string' 
          ? JSON.parse(activityData) 
          : activityData;
        
        // ⭐ LOGIQUE INTELLIGENTE : Filtrage flexible selon la disponibilité des données
        const activityUserId = parsedActivity.userId || parsedActivity.owner_id;
        
        // Si pas de userId dans l'activité, on la prend quand même (anciennes activités)
        // Si userId demandé et présent dans l'activité, on filtre
        const shouldInclude = !activityUserId || activityUserId === userId;
        
        if (shouldInclude) {
          activities.push(parsedActivity);
          
          // Arrêter si on a assez d'activités
          if (activities.length >= limit) {
            break;
          }
        }
      }
    }
    
    // ⭐ CORRECTION : Tri intelligent avec gestion multi-format des dates
    activities.sort((a, b) => {
      // Chercher la date dans plusieurs champs possibles (anciennes vs nouvelles activités)
      const dateA = a.start_date || a.date || a.start_date_local;
      const dateB = b.start_date || b.date || b.start_date_local;
      
      if (!dateA || !dateB) return 0;
      
      try {
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      } catch (e) {
        return 0; // En cas d'erreur de parsing de date
      }
    });
    
    console.log(`✅ ${activities.length} activités récupérées pour userId=${userId}`);
    
    return activities;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des activités brutes:', error);
    return [];
  }
}

// ⭐ Récupérer le timestamp de dernière activité
export async function getLastActivityTimestamp(): Promise<number | null> {
  try {
    const { default: redis } = await import('./redis');
    const timestamp = await redis.get('activities:last_activity');
    
    return timestamp ? parseInt(timestamp.toString()) : null;
  } catch (error) {
    console.error('❌ Erreur récupération timestamp:', error);
    return null;
  }
}

// ⭐ Initialiser le timestamp si pas présent
export async function initializeLastActivityTimestamp(): Promise<void> {
  try {
    const { default: redis } = await import('./redis');
    
    // Vérifier s'il existe déjà
    const exists = await redis.exists('activities:last_activity');
    
    if (!exists) {
      // Récupérer la première activité de la liste pour initialiser
      const firstActivityId = await redis.lindex('activities:ids', 0);
      
      if (firstActivityId) {
        const activityData = await redis.get(`activity:${firstActivityId}`);
        
        if (activityData) {
          const activity = typeof activityData === 'string' 
            ? JSON.parse(activityData) 
            : activityData;
          
          // ⭐ CORRECTION : Chercher la date dans plusieurs champs
          const activityDate = activity.start_date || activity.date || activity.start_date_local;
          
          if (activityDate) {
            await updateLastActivityTimestamp(activityDate);
            console.log('📅 Timestamp initialisé depuis la première activité');
          } else {
            // Pas de date trouvée, initialiser à maintenant
            await redis.set('activities:last_activity', Date.now().toString());
            console.log('📅 Timestamp initialisé à maintenant (pas de date trouvée)');
          }
        }
      } else {
        // Pas d'activités, initialiser à maintenant
        await redis.set('activities:last_activity', Date.now().toString());
        console.log('📅 Timestamp initialisé à maintenant (pas d\'activités)');
      }
    }
  } catch (error) {
    console.error('❌ Erreur initialisation timestamp:', error);
  }
}

// ⭐ NOUVELLE FONCTION : Récupérer une activité spécifique avec gestion des dates
export async function getActivityById(activityId: number): Promise<StravaActivity | null> {
  try {
    const { default: redis } = await import('./redis');
    
    const activityData = await redis.get(`activity:${activityId}`);
    
    if (activityData) {
      const parsedActivity = typeof activityData === 'string' 
        ? JSON.parse(activityData) 
        : activityData;
      
      return parsedActivity;
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Erreur récupération activité ${activityId}:`, error);
    return null;
  }
}

// ⭐ FONCTION UTILITAIRE : Extraire la date d'une activité de manière intelligente
export function getActivityDate(activity: any): string | null {
  // Ordre de priorité pour les champs de date
  return activity.start_date || activity.date || activity.start_date_local || null;
}

// ⭐ FONCTION UTILITAIRE : Vérifier si une activité est récente
export function isActivityRecent(activity: any, daysBack: number = 7): boolean {
  const activityDate = getActivityDate(activity);
  
  if (!activityDate) return false;
  
  try {
    const activityTimestamp = new Date(activityDate).getTime();
    const cutoffTimestamp = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    
    return activityTimestamp >= cutoffTimestamp;
  } catch (e) {
    return false;
  }
}
