import type { Box, Frame } from "./frame";

// Pollen scored, read at the hive. Balls launched at the hive land in its up-facing cell and come to
// rest in a row: there they are big (12-15 px at 720p), bright yellow and still, where at the robot
// they are 3-8 px and blurred. So instead of catching balls in flight, we watch the yellow inside the
// hive box: every volley is a step up, every hive tip (cell empties into the lower cell) a drop.
// Works at the analysis rate (~10 fps); no model. The hive box comes per camera view (found or tapped).

export interface HiveSample { t: number; area: number; bumps: number }

export interface HiveEvent {
  t: number;
  kind: "scored" | "tip";
  balls?: number;     // scored: how many balls arrived in this volley (estimate, ±1)
  from: number;       // yellow area before / after, for tuning
  to: number;
}

/** Pollen yellow: red and green high, blue well below (balls at rest; blurred ones are paler and miss). */
function isPollen(r: number, g: number, b: number) { return r > 150 && g > 150 && b < 0.65 * g && r >= 0.85 * g; }

export class HiveWatcher {
  private box: Box;
  // yellow that is there before the match starts (the BIOBUZZ sign, markers, a stray ball) is not pollen scored
  private still: Uint8Array | null = null;
  private stillN = 0;
  constructor(box: Box) { this.box = box; }

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

  /** Yellow inside the hive box: total area and the number of bumps along the row (balls side by side). */
  push(t: number, f: Frame): HiveSample {
    const x0 = Math.max(0, Math.floor(this.box.x)), y0 = Math.max(0, Math.floor(this.box.y));
    const x1 = Math.min(f.width, Math.ceil(this.box.x + this.box.w)), y1 = Math.min(f.height, Math.ceil(this.box.y + this.box.h));
    const w = Math.max(0, x1 - x0);
    const col = new Float32Array(w);
    const still = this.still && this.stillN >= 3 ? this.still : null, half = this.stillN / 2;
    let area = 0;
    for (let y = y0; y < y1; y++) {
      let p = (y * f.width + x0) * 4;
      for (let x = 0; x < w; x++, p += 4) {
        if (still && still[(y - y0) * w + x] > half) continue;
        if (isPollen(f.data[p], f.data[p + 1], f.data[p + 2])) { area++; col[x]++; }
      }
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
    return { t, area, bumps };
  }
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * Steps in the yellow area → scored volleys and hive tips.
 * ballArea = yellow pixels of one resting ball (depends on the camera; ~100 at 720p from the side).
 * A plateau is a stretch of ≥ `hold` seconds within half a ball of its median; a rise between
 * plateaus is a volley, a fall to under a third of the level is a tip.
 */
export function hiveEvents(samples: HiveSample[], ballArea = 100, hold = 0.6): { events: HiveEvent[]; scored: number; tips: number; plateaus: { t0: number; t1: number; level: number }[] } {
  const events: HiveEvent[] = [];
  const plateaus: { t0: number; t1: number; level: number }[] = [];
  if (samples.length < 3) return { events, scored: 0, tips: 0, plateaus };
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
      events.push({ t: (a.t1 + b.t0) / 2, kind: "scored", balls, from: a.level, to: b.level }); scored += balls;
    } else if (a.level >= 1.5 * ballArea && b.level < 0.35 * a.level) {
      events.push({ t: (a.t1 + b.t0) / 2, kind: "tip", from: a.level, to: b.level }); tips++;
    }
  }
  return { events, scored, tips, plateaus };
}
