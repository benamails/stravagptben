export interface StravaActivity {
  id: string | number;
  name: string;
  sport_type: string;
  distance?: number;
  moving_time?: number;
  start_date: string;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  elev_high?: number;
  elev_low?: number;
  kudos_count?: number;
  achievement_count?: number;
  created_at?: string;
}

export interface StravaActivityDetails {
  calories?: number;
  description?: string;
  gear_id?: string;
  laps?: any[];
  photos?: any[];
  segment_efforts?: any[];
  splits_metric?: any[];
  splits_standard?: any[];
  details_fetched_at?: string;
} // ← MANQUANT

export interface StravaSearchCriteria {
  startDate?: string;
  endDate?: string;
  sportType?: string;
  limit?: number;
} // ← MANQUANT

export interface ImportStatus {
  status: 'none' | 'processing' | 'completed' | 'error';
  progress: number;
  timestamp: string;
  message?: string;
} // ← MANQUANT

export interface ImportResult {
  success: boolean;
  id: string | number;
  error?: string;
} // ← MANQUANT

export interface StravaActivityWithDetails extends StravaActivity {
  details?: StravaActivityDetails;
} // ← MANQUANT
