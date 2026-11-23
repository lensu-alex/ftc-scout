// Pollen scored, read at the hive, against hand-marked launches.
// usage: tsx scripts/eval-hive.ts <clip> <matchStartInClip> x0,y0,x1,y1 [marks.json] [ballArea=100]
import { readFileSync, existsSync } from "node:fs";
import { readFrames } from "../helper/ffmpeg";
import { HiveWatcher, hiveEvents, type HiveSample } from "../src/vision/hive";
const [clip, startS, boxS, marksPath, ballS] = process.argv.slice(2);
const start = +startS, [x0, y0, x1, y1] = boxS.split(",").map(Number), ballArea = ballS ? +ballS : 100;
const watcher = new HiveWatcher({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
const samples: HiveSample[] = [];
const t0 = Date.now();
for await (const { t, frame } of readFrames(clip, 10, Math.max(0, start - 3), 163)) {
  if (t < start - 0.5) watcher.learnStill(frame); else samples.push(watcher.push(t - start, frame));
}
const ms = Date.now() - t0;
const { events, scored, tips, plateaus } = hiveEvents(samples, ballArea);
console.log(`${samples.length} frames in ${(ms / 1000).toFixed(1)} s; ${plateaus.length} plateaus, scored ${scored} balls in ${events.filter(e => e.kind === "scored").length} volleys, ${tips} tips`);
console.log("plateaus: " + plateaus.map(p => `${p.t0.toFixed(1)}-${p.t1.toFixed(1)}:${Math.round(p.level)}`).join("  "));
for (const e of events) console.log(`  ${e.t.toFixed(2).padStart(7)} ${e.kind.padEnd(6)} ${e.kind === "scored" ? `+${e.balls}` : "  "}  ${Math.round(e.from)} → ${Math.round(e.to)}`);
if (marksPath && existsSync(marksPath)) {
  const marks: { t: number; who: string; volley: number }[] = JSON.parse(readFileSync(marksPath, "utf8"));
  const volleys = new Map<number, number>();
  for (const m of marks) if (m.who === "team") volleys.set(+m.t.toFixed(2), m.volley);
  let hit = 0;
  console.log(`\nmarked volleys (team) vs scored events within -0.8..+2.2 s:`);
  for (const [t, n] of [...volleys].sort((a, b) => a[0] - b[0])) {
    const e = events.filter(e => e.kind === "scored" && e.t - t >= -0.8 && e.t - t <= 2.2).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    if (e) hit++;
    console.log(`  ${t.toFixed(2).padStart(7)} launched ${n}  → ${e ? `scored +${e.balls} at ${e.t.toFixed(2)}` : "no event"}`);
  }
  console.log(`${hit}/${volleys.size} volleys seen; marked launches ${[...volleys.values()].reduce((a, b) => a + b, 0)}, scored counted ${scored}`);
  const extra = events.filter(e => e.kind === "scored" && ![...volleys.keys()].some(t => e.t - t >= -0.8 && e.t - t <= 2.2));
  console.log(`${extra.length} scored events with no team mark (partner?): ${extra.map(e => `${e.t.toFixed(1)}(+${e.balls})`).join(" ")}`);
}
