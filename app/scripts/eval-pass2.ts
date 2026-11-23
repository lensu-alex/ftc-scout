// Pass 1 (720p clip): robots + hive volleys. Pass 2 (1080p clip of the same match): launch evidence in the
// 1.6 s before each volley → which robot scored it.
// usage: ALLIANCE='{"red":[ids],"blue":[ids]}' tsx scripts/eval-pass2.ts <clip720> <start720> <clip1080> <start1080> <blueBox> <redBox>
//   boxes in 720p coords x0,y0,x1,y1 (whole hive); startN = match start in seconds into each clip
import { readFrames } from "../helper/ffmpeg";
import { analyzeMatch, type MatchAnalysis } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
import { HiveWatcher, hiveEvents, type HiveSample, type HiveEvent } from "../src/vision/hive";
import { LaunchEvidence, type RobotBoxAt } from "../src/vision/launchEvidence";
import { attributeVolleys, perRobot } from "../src/analysis/attribution";
const [clip720, s720, clip1080, s1080, blueS, redS] = process.argv.slice(2);
const start720 = +s720, start1080 = +s1080;
const box = (s: string) => { const [x0, y0, x1, y1] = s.split(",").map(Number); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const hives = { blue: box(blueS), red: box(redS) };
const ALL: Record<string, number[]> = JSON.parse(process.env.ALLIANCE ?? "{}");
const alliance = (id: number) => (ALL.blue?.includes(id) ? "blue" : ALL.red?.includes(id) ? "red" : null) as "red" | "blue" | null;

// pass 1: one read of the 720p clip feeds both the analysis and the hive watchers
const watchers = { blue: new HiveWatcher(hives.blue), red: new HiveWatcher(hives.red) };
const hs: Record<"blue" | "red", HiveSample[]> = { blue: [], red: [] };
async function* frames() {
  for await (const x of readFrames(clip720, 10, Math.max(0, start720 - 3), 165)) {
    for (const h of ["blue", "red"] as const) { if (x.t < start720 - 0.5) watchers[h].learnStill(x.frame); else hs[h].push(watchers[h].push(x.t - start720, x.frame)); }
    if (x.t >= start720 - 2) yield x;
  }
}
const t0 = Date.now();
const a: MatchAnalysis = await analyzeMatch(frames(), start720, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: true });
const events: (HiveEvent & { hive: "red" | "blue" })[] = [];
for (const h of ["blue", "red"] as const) for (const e of hiveEvents(hs[h], 100).events) events.push({ ...e, hive: h });
events.sort((x, y) => x.t - y.t);
console.log(`pass 1: ${a.robots.length} robot tracks, ${events.filter(e => e.kind === "scored").length} volleys, ${events.filter(e => e.kind === "tip").length} tips in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// robot boxes at a match time, scaled to the 1080p frame
const SC = 1920 / 1280;
function robotsAt(t: number): RobotBoxAt[] {
  const out: RobotBoxAt[] = [];
  for (const r of a.robots) {
    let best = r.path[0];
    for (const p of r.path) if (Math.abs(p.t - (start720 + t)) < Math.abs(best.t - (start720 + t))) best = p;
    if (Math.abs(best.t - (start720 + t)) > 0.6) continue;
    const s = best.s * SC;
    out.push({ id: r.id, box: { x: best.x * SC - s / 2, y: best.y * SC - 0.9 * s, w: s, h: 0.9 * s } });
  }
  return out;
}
// pass 2: a 1080p burst before each volley
const scale = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x * SC, y: b.y * SC, w: b.w * SC, h: b.h * SC });
const ev = new LaunchEvidence([scale(hives.blue), scale(hives.red)].map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h * 0.5 })));   // upper halves: where balls arrive
const t1 = Date.now();
let bursts = 0;
for (const e of events) {
  if (e.kind !== "scored") continue;
  const from = e.t - 1.8;
  let robots: RobotBoxAt[] = [];
  for await (const { t, frame } of readFrames(clip1080, 30, start1080 + from, 1.6, { w: 1920, h: 1080 })) {
    robots = robotsAt(t - start1080);
    ev.push(t - start1080, frame, robots);
  }
  ev.flush(robots); bursts++;
}
console.log(`pass 2: ${bursts} bursts, ${ev.samples.length} frames, ${ev.launches.length} tracked launches in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
const att = attributeVolleys(events, ev.samples, ev.launches, alliance);
for (const x of att) console.log(`${x.hive.padEnd(4)} ${x.t.toFixed(2).padStart(7)} +${x.balls} → robot ${x.robot} conf ${x.confidence.toFixed(2)} | ${x.evidence.map(v => `${v.robot}:${v.px}px ${v.rel}x ${v.blobs}b ${v.launches}L`).join("  ")}`);
const pr = perRobot(att);
console.log("per robot: " + [...pr.entries()].sort((p, q) => p[0] - q[0]).map(([r, v]) => `${r}: ${v.sure} sure + ${v.unsure} unsure (${v.volleys} volleys)`).join("  "));
console.log(`clear volleys: ${att.filter(x => x.confidence >= 0.6).length} / ${att.length}`);
