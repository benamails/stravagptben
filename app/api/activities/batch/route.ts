import { NextRequest, NextResponse } from "next/server";
import { upsertActivitiesFlexible } from "@/lib/upsert-activity"; // ou chemin relatif
export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const arr = Array.isArray(body) ? body : (body.activities ?? []);
    if (!Array.isArray(arr)) {
      return NextResponse.json({ ok:false, error:"Body must be array or {activities:[]}" }, { status:400 });
    }
    const res = await upsertActivitiesFlexible(arr, "gpt");
    const created = res.filter(r=>r.ok && r.created).length;
    return NextResponse.json({ ok:true, created, total:res.length });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
