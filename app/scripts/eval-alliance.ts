// Dev: alliance per track piece, old (robot groups + start side + colour) vs new (src/analysis/alliances.ts),
// on cached pass-1 results (scripts/cache-pass1.ts). Measures, without needing labels:
//  - over-full: share of match time with more than 2 robots of one alliance on screen (impossible in the game)
//  - labelled: share of robot-time (pieces with >= 20 hits) that has an alliance
//  - agree: when two caches of the same match exist (e.g. Mac and Linux), share of robot-time where the robot
//    at the same place gets the same alliance in both (stability against tiny numeric differences)
// usage: tsx scripts/eval-alliance.ts <a.json> [b.json]   (a/b = two caches of the same match)
import { readFileSync } from "node:fs";
import type { MatchAnalysis } from "../src/analysis/analyzeMatch";
import { groupAlliances, robotGroups } from "../src/analysis/run";
import { trackAlliances } from "../src/analysis/alliances";

type A = "red" | "blue" | null;
const load = (f: string) => {
  const d = JSON.parse(readFileSync(f, "utf8"));
  for (const r of d.robots) r.embedding = r.embedding ? Float32Array.from(r.embedding) : null;
  return d as MatchAnalysis;
};
const oldWay = (a: MatchAnalysis) => {
  const groups = robotGroups(a, "Blue"), ga = groupAlliances(a, groups, "Blue"), m = new Map<number, A>();
  for (const r of a.robots) m.set(r.id, null);
  for (const g of groups) for (const id of g.ids) m.set(id, ga.get(g.rep) ?? null);
  return m;
};
const at = (a: MatchAnalysis, t: number) => a.robots.filter(r => r.hits >= 20).flatMap(r => {
  if (t < r.path[0].t || t > r.path[r.path.length - 1].t) return [];
  let b = r.path[0]; for (const p of r.path) if (Math.abs(p.t - t) < Math.abs(b.t - t)) b = p;
  return Math.abs(b.t - t) < 0.6 ? [{ id: r.id, x: b.x, y: b.y, s: b.s }] : [];
});
function stats(a: MatchAnalysis, m: Map<number, A>, b?: MatchAnalysis, mb?: Map<number, A>) {
  let n = 0, over = 0, robotT = 0, lab = 0, both = 0, same = 0;
  for (let t = a.start; t <= a.start + 158; t += 0.5) {
    n++;
    const here = at(a, t), c = { red: 0, blue: 0 };
    for (const h of here) { robotT++; const al = m.get(h.id); if (al) { lab++; c[al]++; } }
    if (c.red > 2 || c.blue > 2) over++;
    if (b && mb) for (const h of here) {
      const o = at(b, t - a.start + b.start).find(q => Math.hypot(q.x - h.x, q.y - h.y) < 0.4 * Math.max(q.s, h.s));
      const x = m.get(h.id), y = o ? mb.get(o.id) : undefined;
      if (o && x && y) { both++; if (x === y) same++; }
    }
  }
  const pc = (p: number, q: number) => (q ? `${Math.round((100 * p) / q)}%` : "-").padStart(5);
  return `over-full ${pc(over, n)}  labelled ${pc(lab, robotT)}` + (b ? `  agree ${pc(same, both)} (${both})` : "");
}
const [fa, fb] = process.argv.slice(2);
const a = load(fa), b = fb ? load(fb) : undefined;
// old grouping, but pieces whose alliance only came from the marking colour stay unknown
const noColour = (a: MatchAnalysis) => {
  const groups = robotGroups(a, "Blue"), m = new Map<number, A>();
  for (const r of a.robots) m.set(r.id, null);
  const ga = groupAlliances(a, groups.map(g => ({ ...g, colour: 0 })), "Blue");
  for (const g of groups) for (const id of g.ids) m.set(id, ga.get(g.rep) ?? null);
  return m;
};
for (const [name, f] of [["old", oldWay], ["no colour", noColour], ["new", trackAlliances]] as const) {
  const ma = f(a), mb = b ? f(b) : undefined;
  console.log(`${name}: ${stats(a, ma, b, mb)}` + (b && mb ? `   | other: ${stats(b, mb)}` : ""));
}
