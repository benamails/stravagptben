// lib/activities.ts
export type RawActivity = Record<string, any>;

export type MinActivity = {
  id: string;
  start_date?: string;
  type?: string;
  athlete_id?: string;
};

export function pickMinimal(raw: RawActivity): MinActivity {
  const id = String(raw.id ?? raw.activity_id ?? "");
  return {
    id,
    start_date: raw.start_date ?? raw.start_date_utc ?? raw.start_date_local,
    type: raw.type,
    athlete_id: raw.athlete?.id ? String(raw.athlete.id) : (raw.athlete_id ? String(raw.athlete_id) : undefined),
  };
}

export function startEpoch(min: MinActivity): number {
  const d = min.start_date;
  return d ? Math.floor(new Date(d).getTime() / 1000) : 0;
}
