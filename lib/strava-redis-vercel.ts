import redis from './redis';
import type { 
  StravaActivity, 
  StravaActivityDetails, 
  StravaSearchCriteria, 
  ImportStatus,
  StravaActivityWithDetails 
} from '../types/strava';

export class StravaRedisService {
  static keys = {
    activity: (id: string | number): string => `strava:activity:${id}`,
    activityDetails: (id: string | number): string => `strava:activity:${id}:details`,
    activitiesByDate: (date: string): string => `strava:activities:date:${date}`,
    activitiesByType: (type: string): string => `strava:activities:type:${type}`,
    lastSync: (): string => 'strava:metadata:last_sync',
    importStatus: (): string => 'strava:import:status'
  };

  // Sauvegarder une activité (optimisé pour serverless)
  static async saveActivity(activity: StravaActivity): Promise<StravaActivity> {
    try {
      const key = this.keys.activity(activity.id);
      
      const baseData: StravaActivity = {
        id: activity.id,
        name: activity.name || '',
        sport_type: activity.sport_type || 'Unknown',
        distance: activity.distance || 0,
        moving_time: activity.moving_time || 0,
        start_date: activity.start_date,
        total_elevation_gain: activity.total_elevation_gain || 0,
        average_speed: activity.average_speed,
        max_speed: activity.max_speed,
        average_heartrate: activity.average_heartrate,
        max_heartrate: activity.max_heartrate,
        created_at: new Date().toISOString()
      };

      // Pipeline pour performance
      const pipeline = redis.pipeline();
      pipeline.hset(key, baseData as Record<string, any>);
      
      // Index par date
      if (activity.start_date) {
        const date = activity.start_date.split('T')[0];
        pipeline.sadd(this.keys.activitiesByDate(date), activity.id.toString());
      }
      
      // Index par type de sport
      pipeline.sadd(this.keys.activitiesByType(activity.sport_type || 'Unknown'), activity.id.toString());
      
      // TTL de 1 an
      pipeline.expire(key, 365 * 24 * 60 * 60);
      
      const results = await pipeline.exec();
      
      // Vérifier les erreurs du pipeline
      const errors = results?.filter(([err]) => err) || [];
      if (errors.length > 0) {
        console.error('Pipeline errors:', errors);
        throw new Error('Failed to save activity');
      }
      
      return baseData;
    } catch (error) {
      console.error('Error saving activity:', error);
      throw error;
    }
  }

  // Sauvegarder les détails d'une activité
  static async saveActivityDetails(
    activityId: string | number, 
    details: StravaActivityDetails
  ): Promise<StravaActivityDetails> {
    const key = this.keys.activityDetails(activityId);
    const detailsData: StravaActivityDetails = {
      ...details,
      details_fetched_at: new Date().toISOString()
    };
    
    await redis.hset(key, detailsData as Record<string, any>);
    await redis.expire(key, 365 * 24 * 60 * 60);
    return detailsData;
  }

  // Récupérer activité avec gestion d'erreur
  static async getActivity(
    activityId: string | number, 
    includeDetails: boolean = false
  ): Promise<StravaActivityWithDetails | null> {
    try {
      const baseActivity = await redis.hgetall(this.keys.activity(activityId));
      
      if (!baseActivity || Object.keys(baseActivity).length === 0) {
        return null;
      }

      const activity = baseActivity as unknown as StravaActivity;

      if (includeDetails) {
        const details = await redis.hgetall(this.keys.activityDetails(activityId));
        return { 
          ...activity, 
          details: Object.keys(details).length > 0 ? details as StravaActivityDetails : undefined 
        };
      }

      return activity;
    } catch (error) {
      console.error('Error getting activity:', error);
      return null;
    }
  }

  // Recherche optimisée pour Vercel
  static async searchActivities(criteria: StravaSearchCriteria = {}): Promise<StravaActivity[]> {
    try {
      const { startDate, endDate, sportType, limit = 50 } = criteria;
      let activityIds = new Set<string>();

      // Recherche par date avec limite
      if (startDate || endDate) {
        const start = new Date(startDate || '2020-01-01');
        const end = new Date(endDate || new Date().toISOString().split('T')[0]);
        
        // Limiter la plage pour éviter les timeouts
        const daysDiff = Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 365) {
          throw new Error('Date range too large (max 365 days)');
        }
        
        const pipeline = redis.pipeline();
        const dateKeys: string[] = [];
        
        for (let d = new Date(start); d <= end && dateKeys.length < 100; d.setDate(d.getDate() + 1)) {
          const dateKey = d.toISOString().split('T')[0];
          dateKeys.push(dateKey);
          pipeline.smembers(this.keys.activitiesByDate(dateKey));
        }
        
        const results = await pipeline.exec();
        results?.forEach(([err, ids]) => {
          if (!err && ids && Array.isArray(ids)) {
            ids.forEach((id: string) => activityIds.add(id));
          }
        });
      }

      // Filtre par type de sport
      if (sportType) {
        const typeIds = await redis.smembers(this.keys.activitiesByType(sportType));
        if (activityIds.size === 0) {
          typeIds.forEach(id => activityIds.add(id));
        } else {
          activityIds = new Set(typeIds.filter(id => activityIds.has(id)));
        }
      }

      // Récupération limitée
      const limitedIds = Array.from(activityIds).slice(0, Math.min(limit, 100));
      
      if (limitedIds.length === 0) {
        return [];
      }

      // Batch récupération
      const pipeline = redis.pipeline();
      limitedIds.forEach(id => {
        pipeline.hgetall(this.keys.activity(id));
      });
      
      const results = await pipeline.exec();
      const activities = results
        ?.map(([err, activity]) => (!err && activity && Object.keys(activity).length > 0) ? activity as StravaActivity : null)
        .filter((activity): activity is StravaActivity => activity !== null) || [];

      return activities;
    } catch (error) {
      console.error('Error searching activities:', error);
      return [];
    }
  }

  // Statut d'import pour le monitoring
  static async setImportStatus(status: ImportStatus['status'], progress: number = 0): Promise<void> {
    const statusData: ImportStatus = {
      status,
      progress,
      timestamp: new Date().toISOString()
    };
    await redis.hset(this.keys.importStatus(), statusData as Record<string, any>);
    await redis.expire(this.keys.importStatus(), 24 * 60 * 60); // 24h TTL
  }

  static async getImportStatus(): Promise<ImportStatus | null> {
    const status = await redis.hgetall(this.keys.importStatus());
    return Object.keys(status).length > 0 ? status as ImportStatus : null;
  }

  // Mettre à jour le timestamp de dernière synchronisation
  static async updateLastSync(): Promise<void> {
    await redis.set(this.keys.lastSync(), new Date().toISOString());
  }

  // Obtenir la dernière synchronisation
  static async getLastSync(): Promise<string | null> {
    return await redis.get(this.keys.lastSync());
  }
}
