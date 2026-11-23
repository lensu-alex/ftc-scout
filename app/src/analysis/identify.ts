import { cosine } from "../vision/appearance";

// Which robot is the team we're scouting?
//
// In every qualification match the team's alliance has two robots: the team and a partner
// that changes from match to match. So across matches, the robot that keeps showing up is the
// team. Each match offers its candidate robots (embeddings); we pick one per match so the
// picks look as alike as possible, then score how sure each pick is.

export interface Candidate { trackId: number; embedding: Float32Array }
export interface MatchCandidates { matchKey: string; candidates: Candidate[] }

export interface Pick {
  matchKey: string;
  trackId: number | null;
  trackIds?: number[];     // all track pieces of the team's robot in this match (see assemble)
  candidates?: number[];   // the robots it was chosen from (offered to the user when unsure)
  confidence: number;      // 0..1: how much better the pick fits than the next best option
  needsConfirmation: boolean;
}

const CONFIDENT = 0.08; // similarity margin above which no question is asked

export function identify(matches: MatchCandidates[], known: Map<string, number> = new Map()): Pick[] {
  const usable = matches.filter(m => m.candidates.length > 0);
  if (usable.length === 0) return matches.map(m => ({ matchKey: m.matchKey, trackId: null, confidence: 0, needsConfirmation: true }));

  // choice[i] = index of the chosen candidate in match i; user answers are fixed
  const choice = usable.map(m => {
    const k = known.get(m.matchKey);
    const i = k === undefined ? 0 : m.candidates.findIndex(c => c.trackId === k);
    return Math.max(0, i);
  });
  const fixed = usable.map(m => known.has(m.matchKey));
  const fit = (i: number, c: number) => {
    let s = 0, n = 0;
    usable.forEach((m, j) => { if (j !== i) { s += cosine(usable[i].candidates[c].embedding, m.candidates[choice[j]].embedding); n++; } });
    return n ? s / n : 0;
  };

  // small cases: try every combination; otherwise improve one match at a time until stable
  const combos = usable.reduce((p, m) => p * m.candidates.length, 1);
  if (combos <= 4096) {
    let best = -Infinity, bestChoice = [...choice];
    const walk = (i: number) => {
      if (i === usable.length) {
        let s = 0;
        for (let a = 0; a < usable.length; a++) for (let b = a + 1; b < usable.length; b++)
          s += cosine(usable[a].candidates[choice[a]].embedding, usable[b].candidates[choice[b]].embedding);
        if (s > best) { best = s; bestChoice = [...choice]; }
        return;
      }
      if (fixed[i]) return walk(i + 1);
      for (let c = 0; c < usable[i].candidates.length; c++) { choice[i] = c; walk(i + 1); }
    };
    walk(0);
    bestChoice.forEach((c, i) => (choice[i] = c));
  } else {
    for (let round = 0; round < 10; round++) {
      let changed = false;
      usable.forEach((m, i) => {
        if (fixed[i]) return;
        let bi = choice[i], bs = fit(i, bi);
        m.candidates.forEach((_, c) => { const s = fit(i, c); if (s > bs) { bs = s; bi = c; } });
        if (bi !== choice[i]) { choice[i] = bi; changed = true; }
      });
      if (!changed) break;
    }
  }

  const picks = new Map<string, Pick>();
  usable.forEach((m, i) => {
    const mine = fit(i, choice[i]);
    const other = Math.max(-1, ...m.candidates.map((_, c) => (c === choice[i] ? -1 : fit(i, c))));
    const margin = m.candidates.length > 1 ? mine - other : 0;
    const confidence = fixed[i] ? 1 : Math.max(0, Math.min(1, margin / (2 * CONFIDENT)));
    picks.set(m.matchKey, {
      matchKey: m.matchKey, trackId: m.candidates[choice[i]].trackId, confidence,
      needsConfirmation: !fixed[i] && (usable.length < 3 || margin < CONFIDENT),
    });
  });
  return matches.map(m => picks.get(m.matchKey) ?? { matchKey: m.matchKey, trackId: null, confidence: 0, needsConfirmation: true });
}

/**
 * The tracker splits a robot into pieces whenever it's hidden. Once the team's robot is known
 * across matches, its average look is a reliable reference: collect every piece in a match that
 * looks like it, doesn't overlap in time with the pieces already taken, and could be reached from
 * them (a robot covers at most ~3 of its own lengths per second).
 */
type End = { t: number; x: number; y: number; s: number };
export interface Piece { trackId: number; embedding: Float32Array | null; from: number; to: number; first?: End; last?: End }

// b continues a: a short gap, and no further than the robot could have driven in it
// (a longer gap, up to 8 s, only for a piece that looks very much like the robot: `alike`)
const reachable = (a: End, b: End, alike = false) => {
  const dt = Math.abs(b.t - a.t), size = Math.max(a.s, b.s, 1);
  return dt <= (alike ? 8 : 3) && Math.hypot(b.x - a.x, b.y - a.y) <= size * (1 + 2 * Math.min(dt, 3));
};

/**
 * The team's path in a match: start from the picked piece and add pieces only where they
 * continue the path (before or after it in time, from where it was). Look-alike pieces that
 * don't connect are other robots and are left out.
 */
export function chain(pieces: Piece[], picked: number): number[] {
  const start = pieces.find(p => p.trackId === picked);
  if (!start) return [picked];
  const take = [start];
  const alike = (p: Piece) => !!(p.embedding && start.embedding && cosine(p.embedding, start.embedding) >= 0.85);
  let grew = true;
  while (grew) {
    grew = false;
    const first = take.reduce((a, b) => (b.from < a.from ? b : a)), last = take.reduce((a, b) => (b.to > a.to ? b : a));
    // the closest piece just after the end, and just before the start
    const after = pieces.filter(p => !take.includes(p) && p.from >= last.to && last.last && p.first && reachable(last.last, p.first, alike(p)))
      .sort((a, b) => a.from - b.from)[0];
    const before = pieces.filter(p => !take.includes(p) && p.to <= first.from && first.first && p.last && reachable(p.last, first.first, alike(p)))
      .sort((a, b) => b.to - a.to)[0];
    for (const p of [after, before]) if (p) { take.push(p); grew = true; }
  }
  return take.map(p => p.trackId);
}

export function assemble(pieces: Piece[], reference: Float32Array, picked: number): number[] {
  const sim = (e: Float32Array | null) => (e ? cosine(e, reference) : -1);
  const pickedSim = sim(pieces.find(p => p.trackId === picked)?.embedding ?? null);
  const floor = Math.max(0.6, pickedSim - 0.12);
  const take: Piece[] = pieces.filter(p => p.trackId === picked);
  for (const p of [...pieces].filter(p => p.trackId !== picked).sort((a, b) => sim(b.embedding) - sim(a.embedding))) {
    if (sim(p.embedding) < floor) break;
    if (take.some(q => p.from < q.to && q.from < p.to)) continue; // a robot can't be in two places at once
    // the pieces just before and after it in time must connect to it in space
    const before = take.filter(q => q.to <= p.from).sort((a, b) => b.to - a.to)[0];
    const after = take.filter(q => q.from >= p.to).sort((a, b) => a.from - b.from)[0];
    if (before?.last && p.first && !reachable(before.last, p.first)) continue;
    if (after?.first && p.last && !reachable(p.last, after.first)) continue;
    take.push(p);
  }
  return take.map(p => p.trackId);
}
