// app/api/activities/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getRedis,
  KEYS,
  getIdsPageByScoreDesc,
  getActivitySummariesByIds,
  getLastActivityIso,
  setLastActivityIso,
  getRefreshedAtIso,
  setRefreshedAtIso,
  clamp as clampNum,
  isStale as isListStale,
  hasActivityDetail,
  markPendingDetail,
  unmarkPendingDetail,
  isPendingDetail,
  setDetailStatusPending,
  setDetailStatusReady,
  setDetailStatusError,
} from "@/lib/redis-old";
import {
  ActivitySummary,
  ActivitiesListResponse,
  DetailPolicy,
  isDetailAutoImportEligible,
} from "@/types/activity";
import { normalizeSummary, summarizeFromDetail, normalizeDetail } from "@/lib/enrichActivity";

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
type LogLevel = "silent" | "error" | "warn" | "info";
const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";
const LEVELS: Record<Exclude<LogLevel, "silent">, number> = { error: 0, warn: 1, info: 2 };

function shouldLog(level: keyof typeof LEVELS) {
  if (LOG_LEVEL === "silent") return false;
  const cur = LEVELS[(LOG_LEVEL as keyof typeof LEVELS) || "info"] ?? 2;
  return LEVELS[level] <= cur;
}

function log(
  level: "info" | "warn" | "error",
  route: string,
  event: string,
  payload: Record<string, unknown> = {}
) {
  if (!shouldLog(level)) return;
  // eslint-disable-next-line no-console
  console[level](JSON.stringify({ ts: new Date().toISOString(), level, route, event, ...payload }));
}

function newRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
export const runtime = "nodejs";
const WINDOW_DAYS = 28;

const DETAIL_MAX_CONCURRENCY = Number(process.env.DETAIL_MAX_CONCURRENCY ?? 3);
const DETAIL_CALL_DELAY_MS = Number(process.env.DETAIL_CALL_DELAY_MS ?? 200);
const DETAIL_CALL_TIMEOUT_MS = Number(process.env.DETAIL_CALL_TIMEOUT_MS ?? 10_000);
const DETAIL_RETRY_MAX = Number(process.env.DETAIL_RETRY_MAX ?? 2);

const MAKE_WEBHOOK_URL_ACTIVITIES = process.env.MAKE_WEBHOOK_URL_ACTIVITIES; // liste incrémentale
const MAKE_WEBHOOK_URL_ACTIVITY = process.env.MAKE_WEBHOOK_URL_ACTIVITY;     // détail unitaire

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function json200<T>(body: T, headers?: Record<string, string>) {
  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers || {}) },
  });
}
function json202<T>(body: T, headers?: Record<string, string>) {
  return new NextResponse(JSON.stringify(body), {
    status: 202,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers || {}) },
  });
}
function pickDetailPolicy(v: string | null): DetailPolicy {
  if (v === DetailPolicy.FORCE) return DetailPolicy.FORCE;
  if (v === DetailPolicy.OFF) return DetailPolicy.OFF;
  return DetailPolicy.AUTO;
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms); });
  try {
    const res = await Promise.race([p, timeout]);
    clearTimeout(t!);
    return res as T;
  } catch (e) {
    clearTimeout(t!);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Make calls (liste & détail)
// ---------------------------------------------------------------------------
async function callMakeActivityDetail(activityId: string, request_id: string): Promise<any> {
  if (!MAKE_WEBHOOK_URL_ACTIVITY) throw new Error("MAKE_WEBHOOK_URL_ACTIVITY is not set");
  const url = new URL(MAKE_WEBHOOK_URL_ACTIVITY);
  url.searchParams.set("activity_id", activityId);

  log("info", "/api/activities", "make_detail_before", { request_id, make_url: url.toString(), activity_id: activityId });
  const started = Date.now();
  const res = await withTimeout(fetch(url.toString(), { method: "GET" }), DETAIL_CALL_TIMEOUT_MS);
  const dur = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log("warn", "/api/activities", "make_detail_after", {
      request_id, status_http: res.status, duration_ms: dur, error_excerpt: text?.slice(0, 200) ?? "",
    });
    const err = new Error(`make_activity_${res.status}`);
    // @ts-ignore
    err.details = text;
    throw err;
  }

  const json = await res.json().catch(() => ({}));
  log("info", "/api/activities", "make_detail_after", {
    request_id, status_http: 200, duration_ms: dur, item_present: Boolean(json?.item ?? json),
  });
  return json;
}

async function callMakeActivitiesIncremental(
  afterIso: string,
  request_id: string,
  limitToMake?: number
): Promise<{ imported: number; last_activity_iso?: string | null }> {
  if (!MAKE_WEBHOOK_URL_ACTIVITIES) throw new Error("MAKE_WEBHOOK_URL_ACTIVITIES is not set");
  const url = new URL(MAKE_WEBHOOK_URL_ACTIVITIES);
  url.searchParams.set("after", afterIso);
  if (typeof limitToMake === "number" && Number.isFinite(limitToMake) && limitToMake > 0) {
    url.searchParams.set("limit", String(limitToMake));
  }

  log("info", "/api/activities", "make_list_before", {
    request_id, make_url: url.toString(), after_used: afterIso, limit_forwarded: limitToMake ?? null,
  });

  const started = Date.now();
  const res = await fetch(url.toString(), { method: "GET" });
  const dur = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log("warn", "/api/activities", "make_list_after", {
      request_id, status_http: res.status, duration_ms: dur, error_excerpt: text?.slice(0, 200) ?? "",
    });
    const err = new Error(`make_activities_${res.status}`);
    // @ts-ignore
    err.details = text;
    throw err;
  }

  const json = (await res.json().catch(() => ({}))) as any;
  const items = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : [];

  // Échantillon de dates reçues (debug)
  try {
    const sample = items.slice(0, 5).map((item) => {
      const v = (k: string) => (Object.prototype.hasOwnProperty.call(item, k) ? { type: typeof (item as any)[k], value: (item as any)[k] } : undefined);
      const tryParse = (val: any): string | null => {
        if (val == null) return null;
        if (typeof val === "string") { const t = Date.parse(val); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
        if (typeof val === "number") { const isSeconds = Math.abs(val) < 1e11; const ms = isSeconds ? val * 1000 : val; const d = new Date(ms); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
        return null;
      };
      const fields: Record<string, any> = {};
      ["date","start_date","start_date_local","start","startDate","timestamp","start_time"].forEach((k)=>{ const x = v(k); if (x) fields[k]=x; });
      let interpreted: string | null = null;
      for (const k of ["date","start_date","start_date_local","start","startDate","timestamp","start_time"]) {
        if (fields[k]) { interpreted = tryParse(fields[k].value); if (interpreted) break; }
      }
      return { id: String((item?.activity_id ?? item?.id) ?? ""), fields, interpreted_iso: interpreted, parsed_ok: Boolean(interpreted) };
    });
    log("info", "/api/activities", "make_list_sample_dates", { request_id, sample_count: sample.length, sample });
  } catch { /* noop */ }

  log("info", "/api/activities", "make_list_after", {
    request_id, status_http: 200, duration_ms: dur, items_count: items.length,
    make_last_activity_iso: typeof (json as any).last_activity_iso === "string" ? (json as any).last_activity_iso : null,
  });

  // Upsert filtrant (empêche activity: vide et dates 1970)
  const redis = getRedis();
  let imported = 0;
  let lastIso: string | null = null;

  for (const raw of items) {
    const summary = normalizeSummary(raw); // <- retourne ActivitySummary | null
    if (!summary) {
      log("warn", "/api/activities", "ingest_skip", {
        request_id,
        reason: !String(raw?.activity_id ?? raw?.id ?? "").trim() ? "no_id" : "bad_or_old_date",
        raw_has_keys: raw ? Object.keys(raw).slice(0, 12) : [],
      });
      continue;
    }

    const startEpoch = Date.parse(summary.date);
    const id = summary.activity_id;

    await redis.set(KEYS.activitySummary(id), JSON.stringify(summary));
    await redis.zadd(KEYS.zsetActivitiesIds, { score: startEpoch, member: id });

    if (!lastIso || summary.date > lastIso) lastIso = summary.date;
    imported++;
  }

  if (lastIso) {
    await setLastActivityIso(lastIso);
    await setRefreshedAtIso(new Date().toISOString());
  }

  return { imported, last_activity_iso: lastIso };
}

// ---------------------------------------------------------------------------
// Auto-import du détail (Run/Ride commute=false)
// ---------------------------------------------------------------------------
type AutoImportCounters = { enqueued: number; started: number; completed: number; errors: number };

async function autoImportDetailsIfNeeded(
  summaries: ActivitySummary[],
  policy: DetailPolicy,
  request_id: string
): Promise<AutoImportCounters> {
  const counters: AutoImportCounters = { enqueued: 0, started: 0, completed: 0, errors: 0 };
  if (policy === DetailPolicy.OFF) return counters;

  const candidates: string[] = [];
  for (const s of summaries) {
    if (!isDetailAutoImportEligible({ type: s.type, commute: s.commute })) continue;

    const exists = await hasActivityDetail(s.activity_id);
    if (exists && policy !== DetailPolicy.FORCE) continue;

    const alreadyPending = await isPendingDetail(s.activity_id);
    if (alreadyPending && policy !== DetailPolicy.FORCE) continue;

    candidates.push(s.activity_id);
  }

  log("info", "/api/activities", "detail_candidates", { request_id, policy, eligible_count: candidates.length });
  if (!candidates.length) return counters;

  const poolSize = Math.max(1, DETAIL_MAX_CONCURRENCY);
  let i = 0;

  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      const id = candidates[idx];

      try {
        await markPendingDetail(id);
        await setDetailStatusPending(id);
        counters.enqueued++;

        if (DETAIL_CALL_DELAY_MS > 0) await sleep(DETAIL_CALL_DELAY_MS);
        counters.started++;

        let attempt = 0;
        let ok = false;
        let lastErr: any = null;

        while (attempt <= DETAIL_RETRY_MAX && !ok) {
          attempt++;
          try {
            const json = await callMakeActivityDetail(id, request_id);
            const raw = json?.item ?? json;

            const detail = normalizeDetail(raw);
            const redis = getRedis();
            await redis.set(KEYS.activityDetailRaw(id), JSON.stringify(raw));
            await redis.set(KEYS.activityDetail(id), JSON.stringify(detail));

            // Résumé -> has_detail true (ou synthèse si absent)
            const summaryStr = (await redis.get(KEYS.activitySummary(id))) as string | null;
            if (summaryStr) {
              const summary = JSON.parse(summaryStr) as ActivitySummary;
              const updated = { ...summary, has_detail: true };
              await redis.set(KEYS.activitySummary(id), JSON.stringify(updated));
            } else {
              const fromDetail = summarizeFromDetail(detail);
              await redis.set(KEYS.activitySummary(id), JSON.stringify(fromDetail));
              await redis.zadd(KEYS.zsetActivitiesIds, { score: Date.parse(fromDetail.date), member: id });
            }

            await setDetailStatusReady(id);
            await unmarkPendingDetail(id);
            counters.completed++;
            ok = true;
          } catch (err: any) {
            lastErr = err;
            if (attempt <= DETAIL_RETRY_MAX) {
              await sleep(200 * attempt);
              continue;
            }
          }
        }

        if (!ok) {
          await setDetailStatusError(id, String(lastErr?.message ?? "detail_ingest_failed"));
          await unmarkPendingDetail(id);
          counters.errors++;
          log("warn", "/api/activities", "detail_failed", { request_id, id, error: String(lastErr?.message || "") });
        }
      } catch (err) {
        counters.errors++;
        log("error", "/api/activities", "detail_worker_exception", { request_id, id, error: String((err as Error).message || "") });
      }
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return counters;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const request_id = newRequestId();
  const t0 = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    const limit = clampNum(Number(searchParams.get("limit") ?? 50), 1, 100);
    const cursor = searchParams.get("cursor");
    const refresh = (searchParams.get("refresh") ?? "auto") as "auto" | "force" | "off";
    const detailPolicy = pickDetailPolicy(searchParams.get("detail"));

    const lastActivityIso = await getLastActivityIso();
    const stale = isListStale(lastActivityIso);

    log("info", "/api/activities", "request_in", {
      request_id, limit, cursor, refresh, detailPolicy, last_activity_iso_read: lastActivityIso, stale,
    });

    let refreshReason: "none" | "auto_due_to_stale" | "force" | "off" = "none";

    // Refresh logique
    if (refresh === "force") {
      refreshReason = "force";
      const after = lastActivityIso ?? new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
      log("info", "/api/activities", "refresh_force_about_to_call", { request_id, after, limit_forwarded: limit });
      try {
        await callMakeActivitiesIncremental(after, request_id, limit);
      } catch (e: any) {
        log("warn", "/api/activities", "refresh_force_call_failed", { request_id, error: String(e?.message || "") });
      }
    } else if (refresh === "auto") {
      if (stale) {
        refreshReason = "auto_due_to_stale";
        const after = lastActivityIso ?? new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
        log("info", "/api/activities", "refresh_auto_about_to_call", { request_id, after, limit_forwarded: limit });
        try {
          await callMakeActivitiesIncremental(after, request_id, limit);
        } catch (e: any) {
          log("warn", "/api/activities", "refresh_auto_call_failed", { request_id, error: String(e?.message || "") });
          const body = {
            ok: false,
            status: "refresh_in_progress",
            retry_after: 5,
            meta: {
              window_days: WINDOW_DAYS,
              refreshed_at: await getRefreshedAtIso(),
              last_activity_iso: lastActivityIso,
              stale: true,
              refresh_reason: refreshReason,
              detail_policy: detailPolicy,
              detail_enqueued_count: 0,
              detail_started_count: 0,
              detail_completed_count: 0,
              detail_errors_count: 0,
            },
          } as const;
          const res = json202(body, { "X-Refresh-Reason": refreshReason, "X-Request-Id": request_id });
          log("info", "/api/activities", "response_out", { request_id, status: 202, latency_ms: Date.now() - t0 });
          return res;
        }
      }
    } else {
      refreshReason = "off";
    }

    // Page ZSET
    const page = await getIdsPageByScoreDesc(limit, cursor);
    const summaries = (await getActivitySummariesByIds(page.ids)) as (ActivitySummary | null)[];

    const items: ActivitySummary[] = [];
    for (let i = 0; i < page.ids.length; i++) {
      const s = summaries[i];
      if (s) items.push({ ...s, has_detail: typeof s.has_detail === "boolean" ? s.has_detail : false });
    }

    log("info", "/api/activities", "page_loaded", {
      request_id, zset_ids_count: page.ids.length, items_returned_count: items.length, next_cursor: page.nextCursor,
    });

    // Auto-import détail
    const counters =
      detailPolicy === DetailPolicy.OFF
        ? { enqueued: 0, started: 0, completed: 0, errors: 0 }
        : await autoImportDetailsIfNeeded(items, detailPolicy, request_id);

    const body: ActivitiesListResponse = {
      ok: true,
      count: items.length,
      next_cursor: page.nextCursor,
      meta: {
        window_days: WINDOW_DAYS,
        refreshed_at: await getRefreshedAtIso(),
        last_activity_iso: await getLastActivityIso(),
        stale,
        refresh_reason: refreshReason,
        detail_policy: detailPolicy,
        detail_enqueued_count: counters.enqueued,
        detail_started_count: counters.started,
        detail_completed_count: counters.completed,
        detail_errors_count: counters.errors,
      },
      items,
    };

    const res = json200(body, { "X-Refresh-Reason": refreshReason, "X-Request-Id": request_id });
    log("info", "/api/activities", "response_out", { request_id, status: 200, latency_ms: Date.now() - t0 });
    return res;
  } catch (err: any) {
    log("error", "/api/activities", "exception", { request_id, error: String(err?.message || "unknown") });
    return NextResponse.json(
      { ok: false, error: "activities_list_failed", message: err?.message ?? "Internal error" },
      { status: 500, headers: { "X-Request-Id": request_id } }
    );
  }
}
