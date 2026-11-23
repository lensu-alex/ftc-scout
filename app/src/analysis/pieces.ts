import type { MatchAnalysis } from "./analyzeMatch";
import { cosine } from "../vision/appearance";

// Two robots per alliance. The tracker leaves each robot in pieces; the team's identified piece(s) seed
// robot A, and every other piece of the alliance goes to A or B: pieces that overlap in time are different
// robots, otherwise the piece joins the robot it looks like and could have been reached from.

export interface Split { team: number[]; partner: number[]; unsure: number[] }   // unsure ⊂ team ∪ partner: placed by a weak preference

type P = MatchAnalysis["robots"][number];
const first = (r: P) => r.path[0], last = (r: P) => r.path[r.path.length - 1];
const overlaps = (a: P, b: P) => first(a).t < last(b).t && first(b).t < last(a).t;

/** How well piece p continues chain c: appearance (cosine of embeddings) plus whether the gap is drivable. */
function fit(p: P, chain: P[]): number {
  let look = 0, n = 0;
  for (const c of chain) if (c.embedding && p.embedding) { look += cosine(c.embedding, p.embedding); n++; }
  look = n ? look / n : 0.75;
  // the nearest chain piece in time, before or after
  let reach = 0.5;
  const before = chain.filter(c => last(c).t <= first(p).t).sort((a, b) => last(b).t - last(a).t)[0];
  const after = chain.filter(c => first(c).t >= last(p).t).sort((a, b) => first(a).t - first(b).t)[0];
  for (const [a, b] of [[before, p], [p, after]] as [P | undefined, P | undefined][]) {
    if (!a || !b) continue;
    const dt = Math.max(0.1, first(b).t - last(a).t), size = Math.max(last(a).s, first(b).s, 1);
    const speed = Math.hypot(first(b).x - last(a).x, first(b).y - last(a).y) / size / dt;   // robot lengths per second
    reach = Math.min(reach, speed <= 3 ? 1 : speed <= 6 ? 0.6 : 0.1);
  }
  return look * reach;
}

export function splitAlliance(a: MatchAnalysis, alliancePieces: number[], teamSeed: number[]): Split {
  const pieces = a.robots.filter(r => alliancePieces.includes(r.id) && r.hits >= 3);
  const A: P[] = pieces.filter(r => teamSeed.includes(r.id));
  const B: P[] = [];
  const rest = pieces.filter(r => !teamSeed.includes(r.id)).sort((x, y) => y.hits - x.hits);
  const unsure: number[] = [];
  // pieces that overlap the seed in time are the partner for sure; repeat with the growing chains
  let changed = true;
  const pending = [...rest];
  while (changed) {
    changed = false;
    for (const p of [...pending]) {
      const hitsA = A.some(c => overlaps(c, p)), hitsB = B.some(c => overlaps(c, p));
      if (hitsA && !hitsB) { B.push(p); pending.splice(pending.indexOf(p), 1); changed = true; }
      else if (hitsB && !hitsA) { A.push(p); pending.splice(pending.indexOf(p), 1); changed = true; }
      else if (hitsA && hitsB) {                                   // overlaps both: a duplicate track or a swap; place by looks, unsure
        unsure.push(p.id); (fit(p, A) >= fit(p, B) ? A : B).push(p); pending.splice(pending.indexOf(p), 1); changed = true;
      }
    }
  }
  // the rest by looks and reachability, most-seen first
  for (const p of pending) {
    const fa = A.length ? fit(p, A) : 0.5, fb = B.length ? fit(p, B) : 0.5;
    if (Math.abs(fa - fb) < 0.08) unsure.push(p.id);          // placed, but its volleys count as unsure
    (fa >= fb ? A : B).push(p);
  }
  return { team: A.map(r => r.id), partner: B.map(r => r.id), unsure };
}
