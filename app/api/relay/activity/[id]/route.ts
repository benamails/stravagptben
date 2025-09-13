// app/api/relay/activity/[id]/route.ts
import type { NextRequest } from "next/server";

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const reqId = crypto.randomUUID();
  const activityId = params.id;

  console.info(`[relay][${reqId}] GET /api/relay/activity/${activityId}`);

  const webhookUrl = process.env.MAKE_WEBHOOK_URL_ACTIVITY;
  if (!webhookUrl) {
    console.error(`[relay][${reqId}] Missing MAKE_WEBHOOK_URL_ACTIVITY`);
    return Response.json({ ok: false, error: "missing_webhook_url" }, { status: 500 });
  }

  const url = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}activity_id=${encodeURIComponent(activityId)}`;

  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const raw = await res.text();
    console.info(`[relay][${reqId}] webhook status=${res.status} len=${raw.length}`);

    if (!res.ok) {
      console.error(`[relay][${reqId}] webhook error body=`, raw?.slice(0, 500));
      return Response.json({ ok: false, error: "webhook_failed", status: res.status }, { status: 502 });
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error(`[relay][${reqId}] JSON parse error`, e);
      return Response.json({ ok: false, error: "invalid_json_from_webhook" }, { status: 502 });
    }

    const normalized = normalizeMakeActivity(payload);
    if (!normalized) {
      console.error(`[relay][${reqId}] normalization failed`, payload);
      return Response.json({ ok: false, error: "invalid_activity_payload_from_make" }, { status: 422 });
    }

    console.info(`[relay][${reqId}] OK activity_id=${normalized.id}`);
    return Response.json({ ok: true, activity: normalized }, { status: 200 });
  } catch (e: any) {
    console.error(`[relay][${reqId}] Unexpected error`, e);
    return Response.json({ ok: false, error: "unexpected_error", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

function normalizeMakeActivity(input: any) {
  if (!input) return null;
  const item = Array.isArray(input) ? input[0] : input;
  if (!item) return null;

  // IMPORTANT: la sortie Make actuelle met plusieurs objets JSON dans une string
  // => on force le mode "liste d'objets concaténés" pour Laps et Splits.
  const laps = parseJsonMaybe(item.Laps, { wrapArrayIfBareObjectList: true });
  const splits = parseJsonMaybe(item.Splits, { wrapArrayIfBareObjectList: true });

  const id = Number(item.activity_id ?? item.id);
  if (!id) return null;

  return {
    id,
    type: item.type ?? item.sport_type ?? "Unknown",
    start_date_local: isoOrNull(item.start_date_local ?? item.date ?? item.start_date),
    moving_time: item.time_moving ?? item.moving_time ?? null,
    elapsed_time: item.time_elapsed ?? item.elapsed_time ?? null,
    distance: item.distance_meter ?? item.distance ?? null,
    total_elevation_gain: item.elevation ?? item.total_elevation_gain ?? null,
    average_watts: item.avg_watts ?? item.average_watts ?? null,   // déjà numerique côté Make selon tes dires
    average_cadence: item.avg_cadence ?? item.average_cadence ?? null,
    suffer_score: item.suffer_score ?? null,
    commute: item.commute ?? item.comute ?? false,                 // tu dis l’avoir corrigé côté Make, donc OK
    laps: Array.isArray(laps) ? laps : laps ? [laps] : [],
    splits_metric: Array.isArray(splits) ? splits : splits ? [splits] : [],
  };
}

function parseJsonMaybe(
  value: any,
  opts?: { wrapArrayIfBareObject?: boolean; wrapArrayIfBareObjectList?: boolean }
) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();

  // Si ça commence par { ou [, on tente un parse direct
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (opts?.wrapArrayIfBareObject && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return [parsed];
      }
      return parsed;
    } catch {
      // on tente le plan B plus bas
    }
  }

  // Cas Make actuel: plusieurs objets concaténés: `{...}, {...}, {...}`
  if (opts?.wrapArrayIfBareObjectList && trimmed.includes("},") && trimmed.includes("{")) {
    try {
      return JSON.parse(`[${trimmed}]`);
    } catch {
      // on laisse tomber
    }
  }

  // Dernière chance: objet unique sans array souhaité
  if (opts?.wrapArrayIfBareObject) {
    try {
      const single = JSON.parse(trimmed);
      return [single];
    } catch { /* noop */ }
  }

  // Fallback: renvoyer la string brute
  return value;
}

function isoOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
