// Pass 1 (720p clip): robots + hive volleys. Pass 2 (1080p clip of the same match): launch evidence in the
// 1.6 s before each volley → which robot scored it.
// usage: ALLIANCE='{"red":[ids],"blue":[ids]}' tsx scripts/eval-pass2.ts <clip720> <start720> <clip1080> <start1080> <blueBox> <redBox>
//   boxes in 720p coords x0,y0,x1,y1 (whole hive); startN = match start in seconds into each clip
import { readFrames } from "../helper/ffmpeg";
import { analyzeMatch, type MatchAnalysis } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
import type { HiveEvent } from "../src/vision/hive";
import { groupAlliances, robotGroups } from "../src/analysis/run";
import { LaunchEvidence, type RobotBoxAt } from "../src/vision/launchEvidence";
import { attributeVolleys, perRobot } from "../src/analysis/attribution";
import { splitAlliance } from "../src/analysis/pieces";
import { ShotLooks, referenceLooks, callVolleys } from "../src/analysis/whoShot";
const [clip720, s720, clip1080, s1080, blueS, redS] = process.argv.slice(2);
const start720 = +s720, start1080 = +s1080;
const box = (s: string) => { const [x0, y0, x1, y1] = s.split(",").map(Number); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const hives = { blue: box(blueS), red: box(redS) };
const ALL: Record<string, number[]> = JSON.parse(process.env.ALLIANCE ?? "{}");
const alliance = (id: number) => (Object.keys(ALL).length ? (ALL.blue?.includes(id) ? "blue" : ALL.red?.includes(id) ? "red" : null) : autoAlliance(id)) as "red" | "blue" | null;

// pass 1: the analysis finds the hive itself and watches it (hand boxes above are only a fallback for the exclusion zones)
const t0 = Date.now();
const a: MatchAnalysis = await analyzeMatch(readFrames(clip720, 10, Math.max(0, start720 - 3), 165), start720, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: true });
const events: (HiveEvent & { hive: "red" | "blue" })[] = a.hiveEvents;
console.log(`pass 1: ${a.robots.length} robot tracks, hive ${JSON.stringify(a.hives.map(h => ({ view: h.view, red: Object.values(h.boxes.red).map(Math.round), blue: Object.values(h.boxes.blue).map(Math.round) })))}`);
console.log(`        ${events.filter(e => e.kind === "scored").length} volleys, ${events.filter(e => e.kind === "tip").length} tips in ${((Date.now() - t0) / 1000).toFixed(0)} s; first ${events.slice(0, 3).map(e => `${e.kind[0]}@${e.t.toFixed(1)}`).join(" ")}`);
// alliance per track: from the robot groups' starting side (or the ALLIANCE env when given)
const groups = robotGroups(a, "Blue");
const ga = groupAlliances(a, groups, "Blue");
const trackAlliance = new Map<number, "red" | "blue" | null>();
for (const g of groups) for (const id of g.ids) trackAlliance.set(id, ga.get(g.rep) ?? null);
console.log("alliances by start side: " + groups.map(g => `${g.rep}[${g.ids.join(",")}]=${ga.get(g.rep)}`).join("  "));
const autoAlliance = (id: number) => trackAlliance.get(id) ?? null;

// robot boxes at a match time, scaled to the 1080p frame
const HD = process.env.PASS2_720 ? false : true;
const FW = HD ? 1920 : 1280, FH = HD ? 1080 : 720;
const SC = FW / 1280;
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
const found = a.hives.find(h => h.view === a.mainView)?.boxes;
const ev = new LaunchEvidence([scale(found?.blue ?? hives.blue), scale(found?.red ?? hives.red)].map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h * 0.6 })));   // where balls arrive
const t1 = Date.now();
let bursts = 0;
const kept: { t: number; frame: typeof a.views[number]["thumb"] & {}; robots: RobotBoxAt[] }[][] = [];   // 3 frames per burst for the looks
for (const e of events) {
  if (e.kind !== "scored") continue;
  const from = e.t - 1.8;
  let robots: RobotBoxAt[] = [], i = 0; const keep: (typeof kept)[number] = [];
  for await (const { t, frame } of readFrames(clip1080, 30, start1080 + from, 1.6, { w: FW, h: FH })) {
    robots = robotsAt(t - start1080);
    ev.push(t - start1080, frame, robots);
    if (i % 16 === 8) keep.push({ t: t - start1080, frame, robots });
    i++;
  }
  ev.flush(robots); bursts++; kept.push(keep);
}
console.log(`pass 2: ${bursts} bursts, ${ev.samples.length} frames, ${ev.launches.length} tracked launches in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
const W = process.env.ATT_WIN ? (() => { const [b, a, r] = process.env.ATT_WIN!.split(","); return { before: +b, after: +a, fromRise: r === "rise" }; })() : undefined;
const att = attributeVolleys(events, ev.samples, ev.launches, alliance, W);
for (const x of att) console.log(`${x.hive.padEnd(4)} ${x.t.toFixed(2).padStart(7)} +${x.balls} → robot ${x.robot} conf ${x.confidence.toFixed(2)} | ${x.evidence.map(v => `${v.robot}:${v.px}px ${v.rel}x ${v.blobs}b ${v.launches}L`).join("  ")}`);
const pr = perRobot(att);
console.log("per robot: " + [...pr.entries()].sort((p, q) => p[0] - q[0]).map(([r, v]) => `${r}: ${v.sure} sure + ${v.unsure} unsure (${v.volleys} volleys)`).join("  "));
console.log(`clear volleys: ${att.filter(x => x.confidence >= 0.6).length} / ${att.length}`);
// SEED=<track id> : the team's identified piece; every blue/red piece of its alliance is then split team / partner
if (process.env.SEED) {
  const seed = +process.env.SEED, mine = (alliance(seed) ?? "blue") as "red" | "blue";
  const alliancePieces = [...new Set([...a.robots.filter(r => alliance(r.id) === mine).map(r => r.id), ...att.flatMap(x => (x.robot !== null && x.hive === mine ? [x.robot] : []))])];
  const sp = splitAlliance(a, alliancePieces, [seed]);
  const balls = (ids: number[]) => att.filter(x => x.hive === mine && x.robot !== null && ids.includes(x.robot)).reduce((acc, x) => { if (x.confidence >= 0.6 && !sp.unsure.includes(x.robot!)) acc.sure += x.balls; else acc.unsure += x.balls; return acc; }, { sure: 0, unsure: 0 });
  console.log(`split (${mine}): team pieces ${JSON.stringify(sp.team)} partner ${JSON.stringify(sp.partner)} unsure ${JSON.stringify(sp.unsure)}`);
  console.log(`team balls ${JSON.stringify(balls(sp.team))}  partner ${JSON.stringify(balls(sp.partner))}  alliance total ${att.filter(x => x.hive === mine).reduce((n, x) => n + x.balls, 0)}`);
  // looks at the moment of the shot
  const looks = referenceLooks(a.robots, [seed], alliancePieces);
  const sl = new ShotLooks(nodeEmbed);
  const scoredIdx = events.map((e, i) => (e.kind === "scored" ? i : -1)).filter(i => i >= 0);
  for (let k = 0; k < att.length; k++) {
    const x = att[k]; if (x.robot === null) continue;
    for (const fr of kept[k] ?? []) { const rb = fr.robots.find(r => r.id === x.robot); if (rb) await sl.add(k, fr.frame, rb.box); }
  }
  const spans = a.robots.map(r => ({ id: r.id, from: r.path[0].t - start720, to: r.path[r.path.length - 1].t - start720 }));
  const calls = callVolleys(att, looks, i => sl.look(i), sp, [seed], spans);
  const tally = { team: { sure: 0, unsure: 0 }, partner: { sure: 0, unsure: 0 }, none: 0 };
  for (let k = 0; k < att.length; k++) {
    const x = att[k], c = calls[k]; if (x.hive !== mine) continue;
    if (!c.who) { tally.none += x.balls; continue; }
    if (c.margin >= 0.5 && x.confidence >= 0.6) tally[c.who].sure += x.balls; else tally[c.who].unsure += x.balls;
  }
  console.log(`by looks+chain: team ${JSON.stringify(tally.team)} partner ${JSON.stringify(tally.partner)} unassigned ${tally.none}`);
  console.log("per volley: " + att.map((x, k) => x.hive === mine ? `${x.t.toFixed(0)}:${x.robot}→${calls[k].who?.[0] ?? "?"}${calls[k].byLook !== null ? `(${calls[k].byLook!.toFixed(2)})` : ""}` : "").filter(Boolean).join(" "));
}
