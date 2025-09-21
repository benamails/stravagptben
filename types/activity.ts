// types/activity.ts
// Contrats de données pour la liste et le détail d'activités Strava,
// ainsi que les statuts d'ingestion du détail et les options de stratégie.

// -------------------------------------------------------------
// Enums & constantes
// -------------------------------------------------------------
export enum DetailPolicy {
  AUTO = "auto",
  FORCE = "force",
  OFF = "off",
}

export enum DetailIngestionState {
  PENDING = "pending",
  READY = "ready",
  ERROR = "error",
}

// -------------------------------------------------------------
// Types de base (splits / laps)
// -------------------------------------------------------------
export type Split = {
  index: number;
  distance_meter: number;
  time_moving: number; // seconds
  pace_s_per_km: number | null;
  avg_hr: number | null;
  avg_watts: number | null;
};

export type Lap = {
  index: number;
  distance_meter: number;
  time_moving: number; // seconds
  avg_hr: number | null;
  avg_watts: number | null;
  note: string | null;
};

// -------------------------------------------------------------
// Résumé d'activité pour la liste (28j) — ActivitySummary
// (a.k.a. ActivityListItem dans la doc)
// -------------------------------------------------------------
export type ActivitySummary = {
  activity_id: string;             // ex: "15844505624"
  date: string;                    // ISO-8601
  type: string;                    // "Run" | "Ride" | ...
  distance_meter: number;
  time_moving: number;             // seconds
  avg_hr: number | null;
  avg_watts: number | null;
  elevation: number | null;
  suffer_score: number | null;
  charge: number | null;
  intensity: number | null;
  commute: boolean | null;         // null si inconnu côté source
  has_detail: boolean;             // true si activity_detail:<id> est présent en cache
};

// -------------------------------------------------------------
// Détail d'activité — ActivityDetail
// -------------------------------------------------------------
export type ActivityDetail = {
  activity_id: string;             // ex: "15844505624"
  name: string | null;
  date: string;                    // ISO-8601
  type: string;                    // "Run" | "Ride" | ...
  distance_meter: number;
  time_moving: number;             // seconds
  time_elapsed: number;            // seconds
  avg_hr: number | null;
  max_hr: number | null;
  avg_watts: number | null;
  max_watts: number | null;
  avg_cadence: number | null;
  elevation_gain: number | null;
  elevation_loss: number | null;
  suffer_score: number | null;
  commute: boolean | null;
  charge: number | null;
  intensity: number | null;

  // Collections détaillées
  splits: Split[] | null;
  laps: Lap[] | null;

  // Pointeur sur le brut en cache (optionnel)
  raw_ref: string | null;          // "activity_detail:{id}:raw"
};

// -------------------------------------------------------------
// Statut d’ingestion du détail (clé: activity_detail:status:<id>)
// -------------------------------------------------------------
export type ActivityDetailStatus = {
  state: DetailIngestionState;     // "pending" | "ready" | "error"
  requested_at?: string;           // ISO-8601
  last_success_at?: string;        // ISO-8601
  last_error_at?: string;          // ISO-8601
  attempts?: number;               // nombre de tentatives
  last_error?: string;             // message court technique
};

// -------------------------------------------------------------
// Meta renvoyée par /api/activities
// -------------------------------------------------------------
export type ActivitiesMeta = {
  window_days: number;             // 28
  refreshed_at: string | null;     // ISO-8601
  last_activity_iso: string | null;// ISO-8601
  stale?: boolean;
  refresh_reason?: "none" | "auto_due_to_stale" | "force" | "off";

  // Auto-import de détail
  detail_policy?: DetailPolicy;    // "auto" | "force" | "off"
  detail_enqueued_count?: number;
  detail_started_count?: number;
  detail_completed_count?: number;
  detail_errors_count?: number;
};

export type ActivitiesListResponse = {
  ok: boolean;
  count: number;
  next_cursor: string | null;      // "{score}|{id}" ou null
  meta: ActivitiesMeta;
  items: ActivitySummary[];
};

export type ActivityDetailResponse =
  | {
      ok: true;
      item: ActivityDetail;
      meta: {
        refreshed_at: string | null; // ISO-8601
        source: "cache" | "make";
      };
    }
  | {
      ok: false;
      status: "triggered_ingestion";
      retry_after: number; // seconds
      meta: {
        source: "relay_detail";
        reason: "not_in_cache";
      };
    }
  | {
      ok: false;
      error: "not_found" | "activity_detail_failed" | "bad_request";
      message: string;
    };

// -------------------------------------------------------------
// Helpers — Garde-fous (validations légères runtime)
// -------------------------------------------------------------

// Utilitaire: test d'ISO 8601 "simple"
const ISO_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// Vérifie sommairement un ActivitySummary
export function isActivitySummary(x: any): x is ActivitySummary {
  return (
    x &&
    typeof x.activity_id === "string" &&
    typeof x.date === "string" &&
    ISO_REGEX.test(x.date) &&
    typeof x.type === "string" &&
    typeof x.distance_meter === "number" &&
    typeof x.time_moving === "number" &&
    // champs optionnels numériques autorisent null
    (x.avg_hr === null || typeof x.avg_hr === "number") &&
    (x.avg_watts === null || typeof x.avg_watts === "number") &&
    (x.elevation === null || typeof x.elevation === "number") &&
    (x.suffer_score === null || typeof x.suffer_score === "number") &&
    (x.charge === null || typeof x.charge === "number") &&
    (x.intensity === null || typeof x.intensity === "number") &&
    (x.commute === null || typeof x.commute === "boolean") &&
    typeof x.has_detail === "boolean"
  );
}

// Vérifie sommairement un Split
export function isSplit(x: any): x is Split {
  return (
    x &&
    typeof x.index === "number" &&
    typeof x.distance_meter === "number" &&
    typeof x.time_moving === "number" &&
    (x.pace_s_per_km === null || typeof x.pace_s_per_km === "number") &&
    (x.avg_hr === null || typeof x.avg_hr === "number") &&
    (x.avg_watts === null || typeof x.avg_watts === "number")
  );
}

// Vérifie sommairement un Lap
export function isLap(x: any): x is Lap {
  return (
    x &&
    typeof x.index === "number" &&
    typeof x.distance_meter === "number" &&
    typeof x.time_moving === "number" &&
    (x.avg_hr === null || typeof x.avg_hr === "number") &&
    (x.avg_watts === null || typeof x.avg_watts === "number") &&
    (x.note === null || typeof x.note === "string")
  );
}

// Vérifie sommairement un ActivityDetail
export function isActivityDetail(x: any): x is ActivityDetail {
  const baseOk =
    x &&
    typeof x.activity_id === "string" &&
    typeof x.type === "string" &&
    typeof x.date === "string" &&
    ISO_REGEX.test(x.date) &&
    typeof x.distance_meter === "number" &&
    typeof x.time_moving === "number" &&
    typeof x.time_elapsed === "number" &&
    (x.avg_hr === null || typeof x.avg_hr === "number") &&
    (x.max_hr === null || typeof x.max_hr === "number") &&
    (x.avg_watts === null || typeof x.avg_watts === "number") &&
    (x.max_watts === null || typeof x.max_watts === "number") &&
    (x.avg_cadence === null || typeof x.avg_cadence === "number") &&
    (x.elevation_gain === null || typeof x.elevation_gain === "number") &&
    (x.elevation_loss === null || typeof x.elevation_loss === "number") &&
    (x.suffer_score === null || typeof x.suffer_score === "number") &&
    (x.commute === null || typeof x.commute === "boolean") &&
    (x.charge === null || typeof x.charge === "number") &&
    (x.intensity === null || typeof x.intensity === "number") &&
    (x.name === null || typeof x.name === "string") &&
    (x.raw_ref === null || typeof x.raw_ref === "string");

  if (!baseOk) return false;

  // splits / laps: autoriser null, sinon tableau d'objets valides
  const splitsOk =
    x.splits === null ||
    (Array.isArray(x.splits) && x.splits.every(isSplit));

  const lapsOk =
    x.laps === null ||
    (Array.isArray(x.laps) && x.laps.every(isLap));

  return splitsOk && lapsOk;
}

// Statut d’ingestion
export function isActivityDetailStatus(x: any): x is ActivityDetailStatus {
  const stateOk =
    x &&
    (x.state === DetailIngestionState.PENDING ||
      x.state === DetailIngestionState.READY ||
      x.state === DetailIngestionState.ERROR);

  const tsOk = (v: any) => v === undefined || typeof v === "string";

  return (
    stateOk &&
    tsOk(x.requested_at) &&
    tsOk(x.last_success_at) &&
    tsOk(x.last_error_at) &&
    (x.attempts === undefined || typeof x.attempts === "number") &&
    (x.last_error === undefined || typeof x.last_error === "string")
  );
}

// -------------------------------------------------------------
// Aides métiers
// -------------------------------------------------------------

/**
 * Renvoie true si l’activité est éligible à l’auto-import de détail.
 * Règle: type ∈ {Run, Ride} ET commute === false
 * (NB: commute === null ou undefined -> non éligible)
 */
export function isDetailAutoImportEligible(
  summary: Pick<ActivitySummary, "type" | "commute">
): boolean {
  const isRunOrRide = summary.type === "Run" || summary.type === "Ride";
  return isRunOrRide && summary.commute === false;
}
