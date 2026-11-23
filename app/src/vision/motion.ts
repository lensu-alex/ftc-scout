import type { Box, Frame } from "./frame";

// What moved, on a fixed camera: a small greyscale background (per-pixel median of frames a
// couple of seconds apart) and the share of a box that differs from it. The detector can be
// unsure about a robot on a camera it never saw (dark, blurred, behind the field walls); a weak
// robot detection over something that is moving is still a robot. People move too, so motion
// only confirms detections, it never creates them.

const W = 160, H = 90;
const EVERY = 2;      // seconds between background samples
const KEEP = 15;      // samples in the median (~30 s): robots that stop longer fade into it
const DIFF = 28;      // grey-level difference that counts as foreground

export class MotionModel {
  private history: Uint8Array[] = [];
  private lastSample = -Infinity;
  private bg: Uint8Array | null = null;
  private cur: Uint8Array | null = null;
  private sx = 1; private sy = 1;

  push(t: number, f: Frame) {
    this.sx = f.width / W; this.sy = f.height / H;
    const g = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (Math.floor((y + 0.5) * this.sy) * f.width + Math.floor((x + 0.5) * this.sx)) * 4;
      g[y * W + x] = (f.data[p] * 77 + f.data[p + 1] * 150 + f.data[p + 2] * 29) >> 8;
    }
    this.cur = g;
    if (t - this.lastSample < EVERY) return;
    this.lastSample = t;
    this.history.push(g);
    if (this.history.length > KEEP) this.history.shift();
    if (this.history.length >= 5) this.bg = median(this.history);
  }

  /** Share of the box (inner part) that differs from the background; null until there is one. */
  moving(b: Box): number | null {
    if (!this.bg || !this.cur) return null;
    const x0 = Math.max(0, Math.floor((b.x + b.w * 0.1) / this.sx)), x1 = Math.min(W, Math.ceil((b.x + b.w * 0.9) / this.sx));
    const y0 = Math.max(0, Math.floor((b.y + b.h * 0.1) / this.sy)), y1 = Math.min(H, Math.ceil((b.y + b.h * 0.9) / this.sy));
    let fg = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) {
      if (Math.abs(this.cur[y * W + x] - this.bg[y * W + x]) > DIFF) fg++;
    }
    return n ? fg / n : null;
  }
}

function median(fs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(W * H), v = new Uint8Array(fs.length), mid = fs.length >> 1;
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < fs.length; k++) v[k] = fs[k][i];
    v.sort();
    out[i] = v[mid];
  }
  return out;
}
