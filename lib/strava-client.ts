import { StravaActivity, StravaTokens, StravaActivityDetails } from '@/types/strava';

export class StravaClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async fetchActivity(activityId: number): Promise<StravaActivity> {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Erreur Strava API: ${response.status}`);
    }

    return await response.json();
  }

  async fetchActivityDetails(activityId: number): Promise<StravaActivityDetails> {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Erreur Strava API: ${response.status}`);
    }

    return await response.json();
  }

  async refreshToken(refreshToken: string): Promise<any> {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      throw new Error(`Erreur refresh token: ${response.status}`);
    }

    return await response.json();
  }

  // ⭐ CORRECTION : Accepter any au lieu de StravaActivity strict
  static shouldFetchDetails(activity: any): boolean {
    // Récupérer les détails pour les courses (Run) de plus de 1km
    return activity.type === 'Run' && (activity.distance || 0) > 1000;
  }
}
