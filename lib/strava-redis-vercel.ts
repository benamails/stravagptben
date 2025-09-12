// lib/strava-redis-vercel.ts - Version Upstash
import redis from './redis';
import type { 
  StravaActivity, 
  StravaActivityDetails, 
  StravaSearchCriteria, 
  ImportStatus,
  StravaActivityWithDetails 
} from '@/types/strava';

export class StravaRedisService {
  static keys = {
    activity: (id: string | number): string => `strava:activity:${id}`,
    activityDetails: (id: string | number): string => `strava:activity:${id}:details`,
    activitiesByDate: (date: string): string => `strava:activities:date:${date}`,
    activitiesByType: (type: string): string => `strava:activities:type:${type}`,
    lastSync: (): string => 'strava:metadata:last_sync',
    importStatus: (): string => 'strava:import:status'
  };

  // Avec @upstash/redis, pas de pipeline.exec(), utilisez les méthodes directement
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
        created_at: new Date().toISOString()
      };

      // Opérations directes avec Upstash
      await redis.hset(key, baseData as Record<string, any>);
      
      // Index par date
      if (activity.start_date) {
        const date = activity.start_date.split('T')[0];
        await redis.sadd(this.keys.activitiesByDate(date), activity.id.toString());
      }
      
      // Index par type de sport
      await redis.sadd(this.keys.activitiesByType(activity.sport_type || 'Unknown'), activity.id.toString());
      
      // TTL de 1 an
      await redis.expire(key, 365 * 24 * 60 * 60);
      
      return baseData;
    } catch (error) {
      console.error('Error saving activity:', error);
      throw error;
    }
  }

  // Reste des méthodes identiques...
}
