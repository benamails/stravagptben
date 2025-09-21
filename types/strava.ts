// types/strava.ts

export interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, any>; // ⭐ Erreur corrigée : il manquait les types génériques
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  start_date: string;
  start_date_local: string;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  elev_high?: number;
  elev_low?: number;
  calories?: number;
  description?: string;
  gear_id?: string;
  
  // ⭐ Champs additionnels pour ton format
  average_watts?: number;
  commute?: boolean;
  upload_id?: number;
  average_cadence?: number;
  suffer_score?: number;
  pr_count?: number;
}

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

export interface ProcessedActivity {
  activityId: number;
  userId: number;
  name: string;
  type: string;
  distance: number;
  duration: number;
  startDate: string;
  processedAt: string;
}

// Nouvelles interfaces pour les détails
export interface StravaActivityDetails {
  id: number;
  splits_metric?: StravaSplit[];
  splits_standard?: StravaSplit[];
  best_efforts?: StravaBestEffort[];
  segment_efforts?: StravaSegmentEffort[];
  photos?: StravaPhotosSummary;
  gear?: StravaGear;
  laps?: StravaLap[];
  calories?: number;
  device_name?: string;
  embed_token?: string;
  splits_metric_distance?: number;
  workout_type?: number;
  // Ajouter d'autres champs selon tes besoins
}

export interface StravaSplit {
  distance: number;
  elapsed_time: number;
  elevation_difference: number;
  moving_time: number;
  split: number;
  average_speed: number;
  pace_zone?: number;
}

export interface StravaBestEffort {
  id: number;
  name: string;
  activity: { id: number };
  athlete: { id: number };
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  distance: number;
  achievements?: any[];
}

export interface StravaSegmentEffort {
  id: number;
  elapsed_time: number;
  start_date: string;
  start_date_local: string;
  distance: number;
  average_watts?: number;
  segment: {
    id: number;
    name: string;
    activity_type: string;
    distance: number;
    average_grade: number;
    maximum_grade: number;
    elevation_high: number;
    elevation_low: number;
  };
}

export interface StravaPhotosSummary {
  count: number;
  primary?: {
    id: number;
    source: number;
    unique_id: string;
    urls: Record<string, string>; // ⭐ Erreur corrigée : il manquait les types génériques
  };
}

export interface StravaGear {
  id: string;
  name: string;
  nickname?: string;
  distance: number;
  brand_name?: string;
  model_name?: string;
  description?: string;
}

export interface StravaLap {
  id: number;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  distance: number;
  start_index: number;
  end_index: number;
  lap_index: number;
  max_speed: number;
  average_speed: number;
  total_elevation_gain: number;
}
