// lib/upsert-activity.ts
import { redis } from "./redis";
import { MinActivity, startEpoch } from "./activities";

export async function upsertActivityFlexible(raw: any, source: "seed"|"webhook"|"gpt"="gpt") {
  const min = { ...pickMinimal(raw) } as MinActivity;
  if (!min.id) return { ok:false, reason:"missing id" };

  const key = `activity:${min.id}`;
  const nowIso = new Date().toISOString();

  const added = await redis.sadd("set:activity_ids", min.id);

  // Hash minimal + blob brut
  await redis.hset(key, {
    id: min.id,
    start_date: min.start_date ?? "",
    type: min.type ?? "",
    athlete_id: min.athlete_id ?? "",
    updated_at: nowIso,
    source,
    raw: JSON.stringify(raw),   // <= flexibilité maximale
  });

  // Index temporel (si date connue)
  const score = startEpoch(min) || Math.floor(Date.now()/1000);
  await redis.zadd("idx:byStartDate", { score, member: key });

  if (min.type) await redis.zadd(`idx:byType:${min.type}`, { score, member: key });
  if (min.athlete_id) await redis.zadd(`idx:athlete:${min.athlete_id}:byStartDate`, { score, member: key });

  return { ok:true, created: added === 1, key };
}

export async function upsertActivitiesFlexible(list: any[], source:"seed"|"webhook"|"gpt"="gpt"){
  const out = [];
  for (const raw of list) out.push(await upsertActivityFlexible(raw, source));
  return out;
}
