import type { Box, Frame } from "./frame";

// Camera cut detection + grouping shots by camera.
//
// Each frame is reduced to a tiny grayscale "fingerprint" with the overlay masked out.
// A cut is a sudden drop in similarity between consecutive samples. Shots from the same
// fixed camera share the same background, so their fingerprints stay similar even while
// robots move: that's how shots are grouped into camera views.

const FW = 48, FH = 27;

export type Fingerprint = Float32Array;

export function fingerprint(f: Frame, mask: Box[] = []): Fingerprint {
  const v = new Float32Array(FW * FH);
  const cw = f.width / FW, ch = f.height / FH;
  for (let gy = 0; gy < FH; gy++) {
    for (let gx = 0; gx < FW; gx++) {
      const cx = (gx + 0.5) * cw, cy = (gy + 0.5) * ch;
      if (mask.some(b => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)) { v[gy * FW + gx] = NaN; continue; }
      // average a 3x3 grid inside the cell: cheap blur that ignores small moving things
      let s = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const x = Math.min(f.width - 1, Math.floor(gx * cw + ((i + 0.5) * cw) / 3));
        const y = Math.min(f.height - 1, Math.floor(gy * ch + ((j + 0.5) * ch) / 3));
        const p = (y * f.width + x) * 4;
        s += f.data[p] * 0.299 + f.data[p + 1] * 0.587 + f.data[p + 2] * 0.114;
      }
      v[gy * FW + gx] = s / 9;
    }
  }
  // each block is normalised on its own (zero-mean, unit-norm) so brightness doesn't matter
  // and a flat block (no texture) is marked as unusable with NaN
  for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
    const idx = blockCells(bx, by).filter(i => !Number.isNaN(v[i])); // masked cells are NaN
    if (idx.length < BW * BH * 0.5) { for (const i of blockCells(bx, by)) v[i] = NaN; continue; }
    let mean = 0;
    for (const i of idx) mean += v[i];
    mean /= idx.length;
    let n = 0;
    for (const i of idx) { v[i] -= mean; n += v[i] * v[i]; }
    n = Math.sqrt(n);
    for (const i of blockCells(bx, by)) v[i] = n < 8 ? NaN : v[i] / n;
  }
  return v;
}

// 6 x 3 blocks of 8 x 9 cells
const BX = 6, BY = 3, BW = FW / BX, BH = FH / BY;
const blockCache: number[][] = [];
function blockCells(bx: number, by: number): number[] {
  const k = by * BX + bx;
  if (!blockCache[k]) {
    const out: number[] = [];
    for (let y = by * BH; y < (by + 1) * BH; y++) for (let x = bx * BW; x < (bx + 1) * BW; x++) out.push(y * FW + x);
    blockCache[k] = out;
  }
  return blockCache[k];
}

/**
 * Share of the frame's blocks that still look the same (block correlation > 0.6).
 * Someone walking in front of the camera changes some blocks; a real camera cut changes
 * nearly all of them, so this stays high under occlusion and drops to ~0 on a cut.
 */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  const sims: number[] = [];
  for (let k = 0; k < BX * BY; k++) {
    let s = 0, used = 0;
    for (const i of blockCells(k % BX, Math.floor(k / BX))) {
      if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
      s += a[i] * b[i]; used++;
    }
    if (used >= BW * BH * 0.5) sims.push(s);
  }
  if (sims.length < 4) return 1; // nearly flat frames (fade to black...): not a cut on their own
  return sims.filter(x => x > 0.6).length / sims.length;
}

export interface Shot {
  start: number;
  end: number;
  view: number;          // camera view id (shots from the same camera share it)
  fp: Fingerprint;       // representative fingerprint (most typical frame of the shot)
  samples: Fingerprint[];
}

export interface ShotTrackerOptions {
  cutBelow: number;      // similarity below this between consecutive samples = cut
  sameViewAbove: number; // similarity above this between shots = same camera
}

/** Feed frames in time order; collects shots and assigns camera view ids. */
export class ShotTracker {
  shots: Shot[] = [];
  views: Fingerprint[] = [];
  private prev: Fingerprint | null = null;
  private opts: ShotTrackerOptions;

  constructor(opts: Partial<ShotTrackerOptions> = {}) {
    this.opts = { cutBelow: 0.2, sameViewAbove: 0.45, ...opts };
  }

  push(t: number, fp: Fingerprint): { cut: boolean; view: number } {
    const cut = !this.prev || similarity(this.prev, fp) < this.opts.cutBelow;
    this.prev = fp;
    if (cut) {
      if (this.shots.length) this.shots[this.shots.length - 1].end = t;
      const view = this.viewFor(fp);
      this.shots.push({ start: t, end: t, view, fp, samples: [fp] });
      return { cut: true, view };
    }
    const cur = this.shots[this.shots.length - 1];
    cur.end = t;
    if (cur.samples.length < 400) cur.samples.push(fp);
    return { cut: false, view: cur.view };
  }

  /**
   * After the match: give each shot a representative frame (the one most like the rest of
   * the shot, so a passer-by at the start doesn't define it) and regroup shots into views,
   * longest shots first. Returns the old → new view ids.
   */
  finish() {
    for (const s of this.shots) {
      const pick = s.samples.filter((_, i) => i % Math.max(1, Math.floor(s.samples.length / 12)) === 0);
      let best = s.fp, bestScore = -1;
      for (const a of pick) {
        let score = 0;
        for (const b of pick) score += similarity(a, b);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      s.fp = best;
    }
    this.views = [];
    const order = [...this.shots].sort((a, b) => (b.end - b.start) - (a.end - a.start));
    for (const s of order) s.view = this.viewFor(s.fp);
  }

  private viewFor(fp: Fingerprint): number {
    let best = -1, bestSim = this.opts.sameViewAbove;
    this.views.forEach((v, i) => {
      const s = similarity(v, fp);
      if (s > bestSim) { bestSim = s; best = i; }
    });
    if (best >= 0) return best;
    this.views.push(fp);
    return this.views.length - 1;
  }

  /** Seconds each view was on screen. The main field camera is usually the longest. */
  viewTime(): Map<number, number> {
    const m = new Map<number, number>();
    for (const s of this.shots) m.set(s.view, (m.get(s.view) ?? 0) + (s.end - s.start));
    return m;
  }
}
