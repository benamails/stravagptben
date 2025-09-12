// scripts/seed-activities.ts
import fs from "node:fs";
import path from "node:path";
import { upsertActivitiesFlexible } from "../lib/upsert-activity";

async function main() {
  const file = path.join(process.cwd(), "data/strava_year.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const arr = Array.isArray(raw) ? raw : (raw.activities ?? []);
  const res = await upsertActivitiesFlexible(arr, "seed");
  const created = res.filter(r=>r.ok && r.created).length;
  console.log(`Seed OK • créées=${created} • total=${res.length}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
