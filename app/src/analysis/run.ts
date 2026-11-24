import { eventMatches, overlayKey, type TeamMatch } from "../api/ftcscout";
import type { VideoSource } from "../video/source";
import { TinyOverlayReader, type OverlayTextReader } from "../vision/tinyOcr";
import { Locator } from "./locate";
import { analyzeMatch, playFrames, type MatchAnalysis, type TimedFrame } from "./analyzeMatch";
import { PLAY_RATE, SAMPLE_EVERY } from "./estimate";
import { MATCH_S } from "../vision/matchClock";
import { assemble, chain, identify, type MatchCandidates, type Pick } from "./identify";
import { cosine, meanEmbedding } from "../vision/appearance";
import type { Infer } from "../vision/detector";
import type { EmbedInfer } from "../vision/appearance";

// Runs the whole pipeline for a team's selected matches on one stream (one event/day).

export type MatchStatus =
  | { state: "waiting" }
  | { state: "locating" }
  | { state: "analysing"; start: number; progress: number }
  | { state: "done"; start: number; analysis: MatchAnalysis; identity?: Pick }
  | { state: "not-found" }
  | { state: "error"; message: string };

export const NO_VIDEO = "couldn't read the video for this match";

let shared: OverlayTextReader | null = null;
export async function overlayReader(make: () => OverlayTextReader = () => new TinyOverlayReader()) {
  if (!shared) {
    shared = make();
    await shared.init();
  }
  return shared;
}

export async function runStream(
  src: VideoSource, matches: TeamMatch[],
  onStatus: (key: string, s: MatchStatus) => void, log: (m: string) => void,
  signal: AbortSignal,
  makeReader?: () => OverlayTextReader,
  framesFor: (src: VideoSource, from: number, to: number) => AsyncIterable<TimedFrame> =
    (src, from, to) => playFrames(src, from, to, PLAY_RATE, SAMPLE_EVERY),
  matchesOf: (event: string) => ReturnType<typeof eventMatches> = e => eventMatches(e),
  models: { infer?: Infer; embedInfer?: EmbedInfer; detectSize?: number } = {},
) {
  const reader = await overlayReader(makeReader);
  const event = matches[0].eventCode;
  const all = await matchesOf(event);
  const api = all.filter(m => m.actualStartTime)
    .map(m => ({ key: overlayKey(m.tournamentLevel, m.matchNum, m.series), start: Date.parse(m.actualStartTime!) / 1000 }));
  const locator = new Locator(src, reader, api, log);
  const done: Analysed = new Map();
  for (const m of matches) {
    if (signal.aborted) return done;
    const key = overlayKey(m.level, m.matchNum, m.series);
    try {
      onStatus(m.key, { state: "locating" });
      const found = await locator.locate(key);
      if (!found) { onStatus(m.key, { state: "not-found" }); continue; }
      onStatus(m.key, { state: "analysing", start: found.start, progress: 0 });
      const frames = framesFor(src, found.start - 3, found.start + MATCH_S + 2);
      const analysis = await analyzeMatch(frames, found.start, reader, { sampleEvery: SAMPLE_EVERY, ...models },
        e => onStatus(m.key, { state: "analysing", start: found.start, progress: Math.max(0, Math.min(1, e / MATCH_S)) }));
      // (a match whose video couldn't be read, or only partly, is an error, not a wrong result)
      if (analysis.framesAnalysed < 0.85 * ((MATCH_S + 4) / SAMPLE_EVERY)) throw new Error(NO_VIDEO);
      onStatus(m.key, { state: "done", start: analysis.start, analysis });
      done.set(m.key, { m, start: analysis.start, analysis });
    } catch (e) {
      const message = (e as Error).message || String(e);
      log(`${m.description}: ${message}`);
      onStatus(m.key, { state: "error", message });
    }
  }

  // which robot is the team? (needs robot tracks with appearance, i.e. the detector models)
  if (models.embedInfer && done.size) {
    for (const pick of identifyTeam(done)) {
      const d = done.get(pick.matchKey)!;
      onStatus(pick.matchKey, { state: "done", start: d.start, analysis: d.analysis, identity: pick });
    }
    log(`robot identified in ${done.size} match(es)`);
  }
  return done;
}

export type Analysed = Map<string, { m: TeamMatch; start: number; analysis: MatchAnalysis }>;

/**
 * The team's robot in every analysed match. `known` = answers from the user (match → track):
 * they are fixed, and they also sharpen the team's reference look for every other match.
 */
export function identifyTeam(done: Analysed, known: Map<string, number> = new Map(), extra: Map<string, number[]> = new Map()): Pick[] {
  // the user said "not shown / can't tell" (-1): that match is left out
  const usable = [...done.values()].filter(({ m }) => known.get(m.key) !== -1);
  const groups = new Map(usable.map(({ m, analysis }) => [m.key, robotGroups(analysis, m.alliance)]));
  const cands: MatchCandidates[] = usable.map(({ m }) => ({ matchKey: m.key, candidates: autoCandidates(groups.get(m.key)!) }));
  // an answer outside the automatic shortlist still counts: add it
  for (const c of cands) {
    const k = known.get(c.matchKey);
    if (k === undefined || c.candidates.some(x => x.trackId === k)) continue;
    const g = groups.get(c.matchKey)!.find(g => g.ids.includes(k));
    if (g) c.candidates.push({ trackId: g.rep, embedding: g.embedding });
  }
  const repKnown = new Map([...known].flatMap(([key, id]) => {
    const g = groups.get(key)?.find(g => g.ids.includes(id));
    return g ? [[key, g.rep] as [string, number]] : [];
  }));
  const picks = identify(cands, repKnown);
  // the team's look, from the confident picks (or all picks if none are confident)
  const embOf = (p: Pick) => groups.get(p.matchKey)?.find(g => g.rep === p.trackId)?.embedding ?? null;
  const sure = picks.filter(p => p.trackId !== null && !p.needsConfirmation && embOf(p));
  const refs = (sure.length ? sure : picks.filter(p => embOf(p))).map(p => embOf(p)!);
  const reference = refs.length ? meanEmbedding(refs) : null;
  for (const pick of picks) {
    const d = done.get(pick.matchKey)!, gs = groups.get(pick.matchKey)!;
    // what the user is shown: every robot seen (most-seen first), always including the current guess
    const shown = gs.slice(0, 8).map(g => g.rep);
    pick.candidates = pick.trackId !== null && !shown.includes(pick.trackId) ? [pick.trackId, ...shown.slice(0, 7)] : shown;
    const group = gs.find(g => g.rep === pick.trackId);
    if (!group) continue;
    // candidates for the rest of its path: its look-alike pieces and pieces similar to the team's look,
    // all on the same camera; then only the ones that actually continue the path (see chain)
    const view = d.analysis.robots.find(r => r.id === pick.trackId)?.view;
    const pieces = d.analysis.robots.filter(r => r.view === view).map(r => ({
      trackId: r.id, embedding: r.embedding, from: r.path[0].t, to: r.path[r.path.length - 1].t,
      first: r.path[0], last: r.path[r.path.length - 1],
    }));
    const similar = reference ? assemble(pieces, reference, pick.trackId!) : [];
    const pool = new Set([...group.ids, ...similar]);
    pick.trackIds = chain(pieces.filter(p => pool.has(p.trackId)), pick.trackId!);
    // more pictures of it the user added: each with its own look-alike pieces that continue it
    for (const id of extra.get(pick.matchKey) ?? []) {
      const g = gs.find(g => g.ids.includes(id));
      const more = chain(pieces.filter(p => p.trackId === id || (g?.ids.includes(p.trackId) ?? false)), id);
      pick.trackIds = [...new Set([...pick.trackIds, ...more])];
    }
  }
  const skipped: Pick[] = [...done.values()].filter(({ m }) => known.get(m.key) === -1).map(({ m, analysis }) => ({
    matchKey: m.key, trackId: null, confidence: 1, needsConfirmation: false,
    candidates: robotGroups(analysis, m.alliance).slice(0, 8).map(g => g.rep),
  }));
  return [...picks, ...skipped];
}

export interface RobotGroup { rep: number; ids: number[]; embedding: Float32Array; hits: number; colour: number }

/**
 * Which alliance is each robot (group of track pieces) on? Robots start the match on their own side of
 * the field: the side of the hive whose colour matches. A group with no piece at the start falls back to
 * its alliance-marking colour (when readable); otherwise unknown.
 */
export function groupAlliances(a: MatchAnalysis, groups: RobotGroup[], teamAlliance: "Red" | "Blue"): Map<number, "red" | "blue" | null> {
  const hive = a.hives.find(h => h.view === a.mainView) ?? a.hives[0];
  const out = new Map<number, "red" | "blue" | null>();
  for (const g of groups) {
    let al: "red" | "blue" | null = null;
    if (hive) {
      const centre = (hive.boxes.red.x + hive.boxes.red.w / 2 + hive.boxes.blue.x + hive.boxes.blue.w / 2) / 2;
      const redLeft = hive.boxes.red.x < hive.boxes.blue.x;
      const early = a.robots.filter(r => g.ids.includes(r.id) && r.path[0].t <= a.start + 4).sort((p, q) => p.path[0].t - q.path[0].t)[0];
      if (early) { const left = early.path[0].x < centre; al = left === redLeft ? "red" : "blue"; }
    }
    // Note (2026-11-24): this colour reads blue for most robots and can put 3-4 robots on screen in one alliance
    // (scripts/eval-alliance.ts). Dropping it removed those states but scored worse on the hand-labelled
    // shooters (tools/gt/shooters), so it stays until attribution itself is fixed.
    if (!al && Math.abs(g.colour) > 0.005) al = (g.colour > 0) === (teamAlliance === "Red") ? "red" : "blue";
    out.set(g.rep, al);
  }
  return out;
}

export { robotGroups };

/**
 * The robots in a match: track pieces that look alike and are never on screen at the same time
 * are one robot (the tracker splits a robot whenever it's hidden). Most-seen first.
 */
function robotGroups(a: MatchAnalysis, alliance: "Red" | "Blue"): RobotGroup[] {
  const main = a.robots.filter(r => r.embedding && r.hits >= 3 && (a.mainView === null || r.view === a.mainView))
    .sort((x, y) => y.hits - x.hits);
  const groups: (RobotGroup & { members: typeof main })[] = [];
  for (const r of main) {
    const from = r.path[0].t, to = r.path[r.path.length - 1].t;
    const g = groups.find(g => cosine(g.embedding, r.embedding!) >= 0.82
      && !g.members.some(q => from < q.path[q.path.length - 1].t && q.path[0].t < to));
    const colour = alliance === "Red" ? r.red - r.blue : r.blue - r.red;
    if (!g) { groups.push({ rep: r.id, ids: [r.id], embedding: r.embedding!, hits: r.hits, colour: colour * r.hits, members: [r] }); continue; }
    g.members.push(r); g.ids.push(r.id); g.colour += colour * r.hits; g.hits += r.hits;
    g.embedding = meanEmbedding(g.members.map(q => q.embedding!));
  }
  // scenery the detector mistook for a robot (posts, hive legs) never moves; a robot drives. It would
  // otherwise win identification: it is there, looking exactly the same, in every match.
  const moves = (g: (typeof groups)[number]) => {
    const pts = g.members.flatMap(q => q.path), s = median(pts.map(p => p.s)) || 1;
    const xs = pts.map(p => p.x).sort((a, b) => a - b), ys = pts.map(p => p.y).sort((a, b) => a - b);
    const q = (v: number[], k: number) => v[Math.floor(k * (v.length - 1))];
    return Math.hypot(q(xs, 0.9) - q(xs, 0.1), q(ys, 0.9) - q(ys, 0.1)) / s >= 1;
  };
  return groups.filter(moves).map(g => ({ ...g, colour: g.colour / g.hits })).sort((x, y) => y.hits - x.hits);
}

/**
 * For automatic identification: the two robots whose markings match the team's alliance (the
 * API says which alliance it's on), when the markings can be read; otherwise the 4 most-seen.
 */
function autoCandidates(gs: RobotGroup[]) {
  const mine = gs.filter(g => g.colour > 0.005);
  const pool = mine.length >= 2 ? [...mine].sort((x, y) => y.colour - x.colour).slice(0, 2) : gs.slice(0, 4);
  return pool.map(g => ({ trackId: g.rep, embedding: g.embedding }));
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
