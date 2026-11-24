import type { MatchAnalysis, RobotSummary } from "./analyzeMatch";
import { cosine, meanEmbedding } from "../vision/appearance";

// Alliance of every robot track piece, from what the game guarantees: 4 robots, 2 per alliance, on the field
// from the start, never changing sides. The pieces seen at the start set up 4 robot "slots" (alliance from
// their starting side). The tracker splits a robot whenever it's hidden, so every later piece is handed to a
// slot that is free at that moment (its previous piece has ended), the one it could have driven from, with
// looks as a second cue. A piece no free slot can explain gets no alliance (null) rather than a guess:
// the marking colour is not used, it reads blue for most robots (blue tape and walls behind them).

type Piece = Pick<RobotSummary, "id" | "hits" | "path" | "view" | "embedding">;
type Alliance = "red" | "blue";
interface Slot { alliance: Alliance; end: number; x: number; y: number; s: number; looks: Float32Array[] }

const EARLY_S = 4;          // pieces starting this soon after the start are the robots' starting places
const MIN_HITS = 3;         // shorter pieces are noise
const OVERLAP_S = 0.5;      // a slot counts as free if its last piece ends at most this long after the new one starts
const SPEED = 3;            // robot lengths per second a robot can plausibly cover while hidden
const MAX_COST = 2.5;       // above this no slot explains the piece

export function trackAlliances(a: Pick<MatchAnalysis, "robots" | "hives" | "mainView" | "start">): Map<number, Alliance | null> {
  const out = new Map<number, Alliance | null>();
  for (const r of a.robots) out.set(r.id, null);
  const hive = a.hives.find(h => h.view === a.mainView) ?? a.hives[0];
  if (!hive) return out;
  const centre = (hive.boxes.red.x + hive.boxes.red.w / 2 + hive.boxes.blue.x + hive.boxes.blue.w / 2) / 2;
  const redLeft = hive.boxes.red.x < hive.boxes.blue.x;
  const pieces: Piece[] = a.robots.filter(r => r.hits >= MIN_HITS && (a.mainView === null || r.view === a.mainView))
    .sort((p, q) => p.path[0].t - q.path[0].t || q.hits - p.hits);

  // starting robots: up to 2 per side, most-seen first
  const slots: Slot[] = [];
  const early = pieces.filter(p => p.path[0].t <= a.start + EARLY_S).sort((p, q) => q.hits - p.hits);
  const used = new Set<number>();
  for (const p of early) {
    const side: Alliance = (p.path[0].x < centre) === redLeft ? "red" : "blue";
    if (slots.filter(s => s.alliance === side).length >= 2) continue;
    if (slots.some(s => s.alliance === side && overlaps(s, p))) { /* same robot seen twice */ }
    slots.push(slotFrom(p, side)); used.add(p.id); out.set(p.id, side);
  }
  if (!slots.length) return out;

  // later pieces, in the order they appear
  for (const p of pieces) {
    if (used.has(p.id)) continue;
    const first = p.path[0];
    let best: { slot: Slot; cost: number } | null = null;
    for (const s of slots) {
      if (s.end > first.t + OVERLAP_S) continue;                     // that robot is on screen elsewhere
      const gap = Math.max(0, first.t - s.end);
      const reach = Math.hypot(first.x - s.x, first.y - s.y) / Math.max(first.s, s.s, 1);
      let cost = reach / (1 + SPEED * gap);
      if (p.embedding && s.looks.length) cost += 2 * (1 - cosine(p.embedding, meanEmbedding(s.looks)));
      if (!best || cost < best.cost) best = { slot: s, cost };
    }
    if (!best || best.cost > MAX_COST) continue;
    const last = p.path[p.path.length - 1];
    Object.assign(best.slot, { end: last.t, x: last.x, y: last.y, s: last.s });
    if (p.embedding) best.slot.looks.push(p.embedding);
    out.set(p.id, best.slot.alliance);
  }
  return out;
}

function slotFrom(p: Piece, alliance: Alliance): Slot {
  const last = p.path[p.path.length - 1];
  return { alliance, end: last.t, x: last.x, y: last.y, s: last.s, looks: p.embedding ? [p.embedding] : [] };
}

function overlaps(s: Slot, p: Piece) { return s.end > p.path[0].t; }
