// dev: every volley's rise (px of yellow) with the see-saw position it happened in. usage: tsx scripts/_rises.ts <cache.json> red|blue
import { readFileSync } from "node:fs";
import { hiveTimeline } from "../src/vision/hive";
const [file, hive] = process.argv.slice(2);
const c = JSON.parse(readFileSync(file, "utf8"));
const r = c.hiveSamples.find((r: any) => r.view === c.mainView && r.hive === hive);
const tl = hiveTimeline(r.samples, r.ballArea, r.mode);
console.log(`ballArea ${Math.round(r.ballArea)} mode ${r.mode} kind ${tl.seesaw?.kind}`);
for (const e of tl.events) {
  const run = tl.seesaw?.runs.find(x => e.t >= x.t0 - 0.01 && e.t <= x.t1 + 0.01);
  const near = r.samples.filter((s: any) => Math.abs(s.t - (e.riseAt ?? e.t)) < 1.5 && !s.hidden);
  const bumps = near.length ? Math.max(...near.map((s: any) => s.bumps)) : 0;
  console.log(`${e.kind.padEnd(6)} t${e.t.toFixed(1).padStart(6)} pos ${run?.pos ?? "-"} ${Math.round(e.from)} → ${Math.round(e.to)} (+${Math.round(e.to - e.from)}) balls ${e.balls ?? ""} bumps ${bumps}`);
}
