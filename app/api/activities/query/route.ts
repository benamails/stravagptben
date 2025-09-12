// app/api/activities/query/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = Number(searchParams.get("from")) || 0;
  const to = Number(searchParams.get("to")) || Date.now()/1000;
  const type = searchParams.get("type") ?? undefined;
  const athlete = searchParams.get("athlete_id") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 500, 2000);

  let key = "idx:byStartDate";
  if (type) key = `idx:byType:${type}`;
  if (athlete) key = `idx:athlete:${athlete}:byStartDate`;

  const members = await redis.zrangebyscore(key, from, to, { withScores:false, limit:{offset:0, count:limit}});
  const pipeline = members.map((k:string)=>["HGET", k, "raw"] as const);
  const raws = pipeline.length ? await redis.pipeline(pipeline).exec() : [];
  // Parse JSON blob à la volée (schema-on-read)
  const activities = raws.map((s:any)=>{ try { return JSON.parse(s as string); } catch { return null; } }).filter(Boolean);

  return NextResponse.json({ ok:true, count:activities.length, activities });
}
