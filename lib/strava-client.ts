// lib/strava-client.ts

import { StravaActivity, StravaTokens, StravaActivityDetails } from '@/types/strava';

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

export class StravaClient {
  private accessToken: string;
  private baseURL = 'https://www.strava.com/api/v3';
  
  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }
  
  async fetchActivity(activityId: number): Promise<StravaActivity> {
    try {
      const response = await fetch(`${this.baseURL}/activities/${activityId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Strava API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'activité:', error);
      throw error;
    }
  }
  
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    try {
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
        throw new Error(`Token refresh failed: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Erreur lors du refresh token:', error);
      throw error;
    }
  }
  
  // ⭐ Nouvelle méthode pour récupérer les détails complets
  async fetchActivityDetails(activityId: number): Promise<StravaActivityDetails> {
    try {
      const response = await fetch(`${this.baseURL}/activities/${activityId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(`Strava API error: ${response.status}`);
      }
      
      const details = await response.json();
      console.log(`✅ Détails récupérés pour l'activité ${activityId}`);
      
      return details;
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération des détails de l'activité ${activityId}:`, error);
      throw error;
    }
  }
  
  // ⭐ Méthode utilitaire pour vérifier si une activité mérite des détails
  static shouldFetchDetails(activity: StravaActivity): boolean {
    return activity.type === 'Run'; // Seulement les courses pour l'instant
  }
}
