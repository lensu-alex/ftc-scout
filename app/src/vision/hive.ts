import type { Box, Frame } from "./frame";
import { label } from "./launchEvidence";

// Pollen scored, read at the hive. Balls launched at the hive land in its up-facing cell and come to
// rest in a row: there they are big (12-15 px at 720p), bright yellow and still, where at the robot
// they are 3-8 px and blurred. So instead of catching balls in flight, we watch the yellow inside the
// hive box: every volley is a step up, every hive tip (cell empties into the lower cell) a drop.
// Works at the analysis rate (~10 fps); no model. The hive box comes per camera view (found or tapped).

export interface HiveSample { t: number; area: number; bumps: number; discs?: number; hidden?: boolean; shape?: number[]; look?: number[] }   // shape: the see-saw's own tubes (12x12 grid); look: its brightness (16x16): to see it tip   // discs: ball-sized blobs (looking down); hidden: a robot covers the box

export interface HiveEvent {
  t: number;          // midpoint between the plateau before and the one after (the balls arrived shortly before)
  riseAt?: number;    // scored: when the new, higher plateau began (the last ball had just landed)
  kind: "scored" | "tip";
  balls?: number;     // scored: how many balls arrived in this volley (estimate, ±1)
  from: number;       // yellow area before / after, for tuning
  to: number;
}

/** Pollen yellow: red and green high, blue well below (balls at rest; blurred ones are paler and miss). */
function isPollen(r: number, g: number, b: number) { return r > 150 && g > 150 && b < 0.65 * g && r >= 0.85 * g; }

export class HiveWatcher {
  private box: Box;
  private roundAreas: number[] = [];
  /** Yellow pixels of one resting ball on this camera, from the lone round blobs seen (null until ~20 were seen). */
  ballArea(): number | null {
    if (this.roundAreas.length < 20) return null;
    const s = [...this.roundAreas].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
  // yellow that is there before the match starts (the BIOBUZZ sign, markers, a stray ball) is not pollen scored
  private still: Uint8Array | null = null;
  private stillN = 0;
  private seesaw: Box | null;
  private tube: (r: number, g: number, b: number) => boolean;
  /** box = where pollen is counted; seesaw = this alliance's whole see-saw (its tubes show which way it faces) */
  constructor(box: Box, seesaw: Box | null = null, colour: "red" | "blue" = "red") {
    this.box = box; this.seesaw = seesaw;
    this.tube = colour === "red" ? (r, g, b) => r > 105 && g < 0.5 * r && b < 0.65 * r : (r, g, b) => b > 95 && r < 0.6 * b && g < 0.82 * b && b - r > 60;
  }

  /** Mean brightness in a 16x16 grid over the see-saw (enlarged 25%): the black-and-white tag panel moves when it tips. */
  private look(f: Frame): number[] | undefined {
    const s = this.seesaw; if (!s) return undefined;
    const G = 16, mx = 0.25 * s.w, my = 0.25 * s.h;
    const x0 = Math.max(0, Math.floor(s.x - mx)), y0 = Math.max(0, Math.floor(s.y - my));
    const x1 = Math.min(f.width, Math.ceil(s.x + s.w + mx)), y1 = Math.min(f.height, Math.ceil(s.y + s.h + my));
    const w = x1 - x0, h = y1 - y0; if (w < G || h < G) return undefined;
    const sum = new Float32Array(G * G), n = new Float32Array(G * G);
    for (let y = y0; y < y1; y += 2) {
      const gy = Math.min(G - 1, Math.floor(((y - y0) * G) / h));
      for (let x = x0; x < x1; x += 2) {
        const p = (y * f.width + x) * 4, k = gy * G + Math.min(G - 1, Math.floor(((x - x0) * G) / w));
        sum[k] += 0.299 * f.data[p] + 0.587 * f.data[p + 1] + 0.114 * f.data[p + 2]; n[k]++;
      }
    }
    return Array.from(sum, (v, k) => Math.round(v / Math.max(1, n[k])));
  }

  /** Share of tube-coloured pixels in each cell of a 12x12 grid over the see-saw (enlarged 25%, it swings). */
  private shape(f: Frame): number[] | undefined {
    const s = this.seesaw; if (!s) return undefined;
    const G = 12, mx = 0.25 * s.w, my = 0.25 * s.h;
    const x0 = Math.max(0, Math.floor(s.x - mx)), y0 = Math.max(0, Math.floor(s.y - my));
    const x1 = Math.min(f.width, Math.ceil(s.x + s.w + mx)), y1 = Math.min(f.height, Math.ceil(s.y + s.h + my));
    const w = x1 - x0, h = y1 - y0; if (w < G || h < G) return undefined;
    const hit = new Float32Array(G * G), n = new Float32Array(G * G);
    for (let y = y0; y < y1; y += 2) {
      const gy = Math.min(G - 1, Math.floor(((y - y0) * G) / h));
      for (let x = x0; x < x1; x += 2) {
        const p = (y * f.width + x) * 4, k = gy * G + Math.min(G - 1, Math.floor(((x - x0) * G) / w));
        n[k]++; if (this.tube(f.data[p], f.data[p + 1], f.data[p + 2])) hit[k]++;
      }
    }
    return Array.from(hit, (v, k) => Math.round((100 * v) / Math.max(1, n[k])) / 100);
  }

  /** Call with frames from before the match start: learns the yellow that is always there. */
  learnStill(f: Frame) {
    const x0 = Math.max(0, Math.floor(this.box.x)), y0 = Math.max(0, Math.floor(this.box.y));
    const x1 = Math.min(f.width, Math.ceil(this.box.x + this.box.w)), y1 = Math.min(f.height, Math.ceil(this.box.y + this.box.h));
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
    if (!this.still || this.still.length !== w * h) { this.still = new Uint8Array(w * h); this.stillN = 0; }
    for (let y = 0; y < h; y++) {
      let p = ((y0 + y) * f.width + x0) * 4;
      for (let x = 0; x < w; x++, p += 4) if (isPollen(f.data[p], f.data[p + 1], f.data[p + 2])) this.still[y * w + x]++;
    }
    this.stillN++;
  }

  /**
   * Yellow inside the hive box: total area and the number of bumps along the row (balls side by side).
   * `robots` = boxes of the robots on screen now: balls a robot carries are not pollen in the hive
   * (seen from above, robots drive right through the hive box).
   */
  push(t: number, f: Frame, robots: Box[] = []): HiveSample {
    const x0 = Math.max(0, Math.floor(this.box.x)), y0 = Math.max(0, Math.floor(this.box.y));
    const x1 = Math.min(f.width, Math.ceil(this.box.x + this.box.w)), y1 = Math.min(f.height, Math.ceil(this.box.y + this.box.h));
    const w = Math.max(0, x1 - x0);
    const col = new Float32Array(w);
    const still = this.still && this.stillN >= 3 ? this.still : null, half = this.stillN / 2;
    const rb = robots.map(b => { const m = 0.15 * Math.max(b.w, b.h); return { x0: b.x - m, y0: b.y - m, x1: b.x + b.w + m, y1: b.y + b.h + m }; })
      .filter(b => b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1);
    // a robot over most of the box hides the hive: that sample says nothing (not "zero balls")
    let covered = 0;
    for (const b of rb) covered += (Math.min(b.x1, x1) - Math.max(b.x0, x0)) * (Math.min(b.y1, y1) - Math.max(b.y0, y0));
    const hidden = covered > 0.5 * w * (y1 - y0);
    let area = 0;
    const hh = y1 - y0, mask = new Uint8Array(w * hh);
    for (let y = y0; y < y1; y++) {
      let p = (y * f.width + x0) * 4;
      for (let x = 0; x < w; x++, p += 4) {
        if (still && still[(y - y0) * w + x] > half) continue;
        if (rb.length) { let inR = false; for (const b of rb) if (x + x0 >= b.x0 && x + x0 < b.x1 && y >= b.y0 && y < b.y1) { inR = true; break; } if (inR) continue; }
        if (isPollen(f.data[p], f.data[p + 1], f.data[p + 2])) { area++; col[x]++; mask[(y - y0) * w + x] = 1; }
      }
    }
    // ball-sized round blobs (seen from above a ball is a clean disc; from the side a row merges and bumps are used)
    const D = Math.max(6, 0.09 * this.box.w) * 1.4, one = (Math.PI / 4) * D * D;
    const { lab, sizes } = label(mask, w, hh);
    const bx0 = new Int32Array(sizes.length).fill(w), bx1 = new Int32Array(sizes.length), by0 = new Int32Array(sizes.length).fill(hh), by1 = new Int32Array(sizes.length);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const l = lab[y * w + x]; if (!l) continue; if (x < bx0[l]) bx0[l] = x; if (x + 1 > bx1[l]) bx1[l] = x + 1; if (y < by0[l]) by0[l] = y; if (y + 1 > by1[l]) by1[l] = y + 1; }
    let discs = 0;
    for (let l = 1; l < sizes.length; l++) {
      const a = sizes[l], bw = bx1[l] - bx0[l], bh = by1[l] - by0[l];
      const asp = bw / Math.max(1, bh), fill = a / (bw * bh);
      // a lone round blob of a plausible size: remember its area (what one ball looks like on this camera)
      if (asp >= 0.7 && asp <= 1.4 && fill >= 0.6 && a >= 20 && a <= 900 && this.roundAreas.length < 4000) this.roundAreas.push(a);
      if (a < 0.35 * one) continue;
      if (asp >= 0.55 && asp <= 1.8 && fill >= 0.5) discs += Math.max(1, Math.round(a / one));
    }
    // bumps in the column profile (smoothed over 5 px), at least a ball apart
    let bumps = 0, last = -100;
    const ball = Math.max(6, Math.round(0.08 * this.box.w));
    for (let x = 2; x < w - 2; x++) {
      const s = (col[x - 2] + col[x - 1] + col[x] + col[x + 1] + col[x + 2]) / 5;
      const l = (col[Math.max(0, x - 3)] + col[x - 2] + col[x - 1] + col[x] + col[x + 1]) / 5;
      const r = (col[x - 1] + col[x] + col[x + 1] + col[x + 2] + col[Math.min(w - 1, x + 3)]) / 5;
      if (s >= 3 && s >= l && s >= r) { if (x - last >= ball * 0.7) { bumps++; last = x; } }
    }
    return { t, area, bumps, discs, hidden, shape: this.shape(f), look: this.look(f) };
  }
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * Steps in the yellow area → scored volleys and hive tips.
 * ballArea = yellow pixels of one resting ball (depends on the camera; ~100 at 720p from the side).
 * A plateau is a stretch of ≥ `hold` seconds within half a ball of its median; a rise between
 * plateaus is a volley, a fall to under a third of the level is a tip.
 */
export function hiveEvents(samples: HiveSample[], ballArea = 100, hold = 0.6, mode: "area" | "discs" = "area"): { events: HiveEvent[]; scored: number; tips: number; plateaus: { t0: number; t1: number; level: number }[] } {
  const events: HiveEvent[] = [];
  const plateaus: { t0: number; t1: number; level: number }[] = [];
  samples = samples.filter(s => !s.hidden);
  if (samples.length < 3) return { events, scored: 0, tips: 0, plateaus };
  // cameras looking down: count discs, and a count must hold 2 s (robots drive under the hive)
  if (mode === "discs") { samples = samples.map(s => ({ ...s, area: (s.discs ?? 0) * ballArea })); hold = Math.max(hold, 2); }
  // median filter over ~0.5 s to drop balls flying through
  const dt = (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1);
  const k = Math.max(1, Math.round(0.25 / dt));
  const m = samples.map((_, i) => median(samples.slice(Math.max(0, i - k), i + k + 1).map(s => s.area)));
  // plateaus: grow while within half a ball of the running median
  let i = 0;
  while (i < samples.length) {
    let j = i + 1;
    const vals = [m[i]];
    while (j < samples.length && Math.abs(m[j] - median(vals)) <= 0.5 * ballArea) { vals.push(m[j]); j++; }
    if (samples[j - 1].t - samples[i].t >= hold) plateaus.push({ t0: samples[i].t, t1: samples[j - 1].t, level: median(vals) });
    i = j;
  }
  let scored = 0, tips = 0;
  for (let p = 1; p < plateaus.length; p++) {
    const a = plateaus[p - 1], b = plateaus[p];
    const d = b.level - a.level;
    if (d >= 0.6 * ballArea) {
      const balls = Math.max(1, Math.round(d / ballArea));
      events.push({ t: (a.t1 + b.t0) / 2, riseAt: b.t0, kind: "scored", balls, from: a.level, to: b.level }); scored += balls;
    } else if (a.level >= 1.5 * ballArea && b.level < 0.35 * a.level) {
      events.push({ t: (a.t1 + b.t0) / 2, kind: "tip", from: a.level, to: b.level }); tips++;
    }
  }
  return { events, scored, tips, plateaus };
}

/**
 * Hive tips from the see-saw itself: it rests in one of two positions and every tip flips it to the other.
 * Each sample carries two pictures of the see-saw (its tube colour on a 12x12 grid, its brightness on 16x16);
 * per picture kind the samples are split into two positions (2-means), and the kind that separates them more
 * cleanly is used (against a blue wall the blue tubes vanish; the black-and-white tag panel never does).
 * Samples close to neither position (a robot or person in front) are ignored; a position must hold `hold` s.
 * Returns the flip times, the stable stretches (which position, from, to) and how clean the split was (0..1).
 */
export function seesawFlips(samples: HiveSample[], hold = 1.2, ambiguous = 0.6) {
  const S = samples.filter(s => s.shape && s.look && !s.hidden);
  let best: { flips: number[]; runs: { pos: 0 | 1; t0: number; t1: number }[]; quality: number; kind: "shape" | "look" } | null = null;
  if (S.length < 30) return { flips: [] as number[], runs: [] as { pos: 0 | 1; t0: number; t1: number }[], quality: 0, kind: "shape" as const };
  const zs = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) + 1e-6; return v.map(x => (x - m) / sd); };
  for (const kind of ["shape", "look"] as const) {
    const V = S.map(s => (kind === "shape" ? s.shape! : zs(s.look!)));
    const D = V[0].length;
    // median over 5 samples (~0.5 s)
    const Vs = V.map((_, i) => { const w = V.slice(Math.max(0, i - 2), i + 3); return Array.from({ length: D }, (_, d) => median(w.map(v => v[d]))); });
    const dist = (a: number[], b: number[]) => { let s = 0; for (let d = 0; d < D; d++) s += (a[d] - b[d]) ** 2; return Math.sqrt(s); };
    const mean = (vs: number[][]) => Array.from({ length: D }, (_, d) => vs.reduce((s, v) => s + v[d], 0) / Math.max(1, vs.length));
    let a = mean(Vs.filter((_, i) => S[i].t < S[0].t + 1));
    let b = Vs.reduce((far, v) => (dist(v, a) > dist(far, a) ? v : far), Vs[0]);
    let lab: boolean[] = [];
    for (let it = 0; it < 20; it++) {
      lab = Vs.map(v => dist(v, a) < dist(v, b));
      if (lab.every(x => x) || lab.every(x => !x)) break;
      a = mean(Vs.filter((_, i) => lab[i])); b = mean(Vs.filter((_, i) => !lab[i]));
    }
    const da = Vs.map(v => dist(v, a)), db = Vs.map(v => dist(v, b));
    const state = Vs.map((_, i) => (Math.min(da[i], db[i]) / Math.max(da[i], db[i], 1e-6) > ambiguous ? -1 : da[i] < db[i] ? 0 : 1));
    const runs: { pos: 0 | 1; t0: number; t1: number }[] = [];
    for (let i = 0; i < state.length; ) {
      let j = i; while (j < state.length && state[j] === state[i]) j++;
      if (state[i] >= 0 && S[j - 1].t - S[i].t >= hold) {
        const last = runs[runs.length - 1];
        if (last && last.pos === state[i]) last.t1 = S[j - 1].t; else runs.push({ pos: state[i] as 0 | 1, t0: S[i].t, t1: S[j - 1].t });
      }
      i = j;
    }
    const quality = da.reduce((s, x, i) => s + (Math.max(x, db[i]) - Math.min(x, db[i])) / Math.max(x, db[i], 1e-6), 0) / da.length;
    const flips = runs.slice(1).map((r, k) => (runs[k].t1 + r.t0) / 2);
    if (!best || quality > best.quality) best = { flips, runs, quality, kind };
  }
  return best!;
}
