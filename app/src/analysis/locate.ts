import type { VideoSource } from "../video/source";
import { findScoreBar } from "../vision/overlay";
import type { MatchName } from "../vision/ocr";
import type { OverlayTextReader } from "../vision/tinyOcr";
import { elapsedFor, MATCH_S, TRANSITION_S } from "../vision/matchClock";

// Finding matches inside a long stream with as few seeks as possible.
//
// 1. Anchor: look at a few spots until any match is on screen with its clock. Its name
//    (OCR) + the API's start time for that match give: stream time = API time + offset.
// 2. Every other match: jump to API time + offset, read the clock to get the exact start,
//    and check the name. If the stream had a break (restart, a second VOD) the name won't
//    match, and we re-anchor from whatever match is on screen there.

export interface ApiMatch { key: string; start: number } // overlay key ("Q7") + API start (unix s)

export interface Probe {
  t: number;
  key: string | null;      // overlay match key at t, e.g. "Q7"
  clock: number | null;
  matchStart: number | null; // stream time this match started, from the clock
}

export function overlayKeyOf(n: MatchName): string {
  const p = n.level === "Qualification" ? "Q" : n.level === "Playoff" ? "P" : n.level === "Final" ? "F"
    : n.level === "Practice" ? "PR" : n.level === "Test" ? "T" : "X";
  return `${p}${n.number}`;
}

export class Locator {
  private src: VideoSource;
  private reader: OverlayTextReader;
  private api: Map<string, number>;
  offset: number | null = null; // stream time − API unix time
  private seen: { t: number; ord: number }[] = []; // every look that showed a match name
  private empty: number[] = [];                     // looks with nothing usable on screen
  probes = 0;
  log: (msg: string) => void;

  constructor(src: VideoSource, reader: OverlayTextReader, apiMatches: ApiMatch[], log: (m: string) => void = () => {}) {
    this.src = src;
    this.reader = reader;
    this.api = new Map(apiMatches.map(m => [m.key, m.start]));
    this.log = log;
  }

  async probe(t: number): Promise<Probe> {
    const p = await this.look(t);
    // 0:01–0:08 is either the auto→teleop pause or the end of teleop: look again 12 s later
    if (p.clock !== null && p.clock > 0 && p.clock <= TRANSITION_S) {
      const q = await this.look(t + 12);
      if (q.key === p.key && q.clock !== null && q.clock > TRANSITION_S && q.clock < 150) return q;
      if (q.key === p.key && (q.clock === 0 || q.clock === null)) p.matchStart = p.t - elapsedFor(p.clock);
    }
    return p;
  }

  private async look(t: number): Promise<Probe> {
    this.probes++;
    await this.src.seek(t);
    const f = await this.src.grab();
    const at = this.src.currentTime();
    const p: Probe = { t: at, key: null, clock: null, matchStart: null };
    if (!f) return p;
    const bar = findScoreBar(f);
    if (!bar) { this.log(`look ${fmt(at)}: no bar`); return p; }
    const [clock, name] = await Promise.all([this.reader.readClock(f, bar), this.reader.readMatchName(f, bar)]);
    p.clock = clock;
    p.key = name ? overlayKeyOf(name) : null;
    if (p.key && !/^(T|PR)\d/.test(p.key)) this.seen.push({ t: at, ord: ordinal(p.key) });
    else this.empty.push(at);
    // clock values that pin the start unambiguously (2:30 = not started, 0:00 = over)
    if (clock !== null && clock < 150 && clock > TRANSITION_S) p.matchStart = at - elapsedFor(clock);
    this.log(`look ${fmt(at)}: ${p.key ?? "?"} clock ${clock ?? "?"} (${name?.raw ?? "no bar text"})`);
    return p;
  }

  private learn(p: Probe): boolean {
    if (p.key === null || p.matchStart === null) return false;
    const api = this.api.get(p.key);
    if (api === undefined) return false;
    this.offset = p.matchStart - api;
    this.log(`anchored on ${p.key} at ${fmt(p.matchStart)}`);
    return true;
  }

  /** Look around the stream until one known match is on screen with a running clock. */
  async anchor(near?: number): Promise<boolean> {
    const dur = this.src.duration();
    const centres = near !== undefined ? [near] : [0.15, 0.4, 0.65, 0.3, 0.55, 0.8, 0.05, 0.9].map(x => x * dur);
    for (const c of centres) {
      let t = c;
      // walk forward: a pre-match bar (2:30) means the match is about to start
      for (let i = 0; i < 6 && t < dur - 5; i++) {
        const p = await this.probe(t);
        if (this.learn(p)) return true;
        t += p.clock === 150 ? 30 : 50;
      }
    }
    return false;
  }

  /** Stream time the given match started, or null if it isn't in this stream. */
  async locate(key: string): Promise<{ start: number; confidence: "high" | "medium" } | null> {
    const api = this.api.get(key);
    if (api === undefined) return this.searchByName(key);
    if (this.offset === null && !(await this.anchor())) return this.searchByName(key);
    let t = api + this.offset! + 15; // 15 s into auto
    let jumps = 0, misses = 0;
    for (let i = 0; i < 14; i++) {
      const p = await this.probe(t);
      if (p.key === key && p.matchStart !== null) {
        this.offset = p.matchStart - api; // keep the offset fresh, streams drift
        return { start: p.matchStart, confidence: i < 3 ? "high" : "medium" };
      }
      if (p.key === key) {
        // right match, clock not running: 2:30 → it starts later, 0:00 → it already ran
        t += p.clock === 150 ? 30 : p.clock === 0 ? -120 : 20;
        continue;
      }
      if (p.key !== null && p.key !== key && this.learn(p) && jumps++ < 3) {
        // the stream drifted or restarted: the match on screen gives a fresh offset
        t = api + this.offset! + 15;
        continue;
      }
      // nothing readable here (camera on the crowd, a slide...): spiral outwards
      misses++;
      t = api + this.offset! + 15 + (misses % 2 ? 1 : -1) * Math.ceil(misses / 2) * 40;
    }
    this.log(`${key}: not found from API times, searching by name`);
    return this.searchByName(key);
  }

  /** A time in [a, b] near `guess` that is at least 60 s from every look so far. */
  private freeSpot(a: number, b: number, guess: number): number | null {
    if (b <= a) return null;
    const looked = [...this.empty, ...this.seen.map(s => s.t)];
    const ok = (t: number) => looked.every(x => Math.abs(x - t) >= 60);
    for (let d = 0; d <= b - a; d += 45) {
      for (const t of [guess + d, guess - d]) if (t >= a && t <= b && ok(t)) return t;
    }
    return null;
  }

  /**
   * No usable API time (results not uploaded, or the stream doesn't line up): matches are
   * played in order, so narrow down between the closest earlier and later matches seen.
   */
  async searchByName(key: string): Promise<{ start: number; confidence: "high" | "medium" } | null> {
    const target = ordinal(key), dur = this.src.duration();
    for (let i = 0; i < 30; i++) {
      let lo = { t: 0, ord: -1 }, hi = { t: dur, ord: 1e9 };
      for (const s of this.seen) {
        if (s.ord < target && s.t > lo.t) lo = s;
        if (s.ord > target && s.t < hi.t) hi = s;
      }
      if (hi.t - lo.t < 30) break;
      const here = this.seen.filter(s => s.ord === target).sort((a, b) => a.t - b.t);
      let guess: number;
      if (here.length) guess = here[here.length - 1].t + 30; // seen it: walk forward to the running clock
      else if (lo.ord >= 0 && hi.ord < 1e9 && Math.floor(hi.ord / 1000) === Math.floor(lo.ord / 1000))
        guess = lo.t + ((target - lo.ord) / (hi.ord - lo.ord)) * (hi.t - lo.t);
      else guess = (lo.t + hi.t) / 2;
      const t = here.length ? guess : this.freeSpot(lo.t + 10, hi.t - 10, guess);
      if (t === null) break;
      const p = await this.probe(t);
      if (p.key === key && p.matchStart !== null) return { start: p.matchStart, confidence: "medium" };
    }
    this.log(`${key}: not found in this stream`);
    return null;
  }
}

const LEVELS: Record<string, number> = { PR: 0, T: 0, Q: 1, P: 2, F: 3, X: 4 };
/** Match order within an event: practice < quals < playoffs < finals. */
export function ordinal(key: string): number {
  const m = key.match(/^([A-Z]+)(\d+)$/);
  return m ? (LEVELS[m[1]] ?? 4) * 1000 + +m[2] : 0;
}

export function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`;
}

export { MATCH_S };
