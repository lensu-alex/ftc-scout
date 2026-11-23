import type { Box, Frame } from "./frame";

// Who launched? At 1080p and 30 fps a ball leaving a robot is visible for a few frames just above it: new
// yellowness (a pale yellow streak or ball) that was not there in the previous frame. Per robot we count
// those pixels and blobs in a window above its box; separately, blobs that can be linked over 3+ frames
// into a rising path starting above a robot are counted as tracked launches (the strongest evidence).
// The robots' boxes come from the 720p analysis and are scaled to this frame.

export interface RobotBoxAt { id: number; box: Box }   // box in this frame's pixel coordinates
export interface EvidenceSample { t: number; above: Map<number, { px: number; blobs: number }> }
export interface Launch { t: number; robot: number; x: number; y: number; points: number }

const MAX_BLOB_1080 = 450;     // px at 1080p: bigger changes are people, robots, the hive moving

function yellowness(f: Frame, out: Int16Array) {
  const d = f.data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = ((d[p] + d[p + 1]) >> 1) - d[p + 2];
}

/** Connected components of a boolean mask (4-neighbour), returning per-pixel label and component sizes. */
function label(mask: Uint8Array, w: number, h: number): { lab: Int32Array; sizes: number[]; cx: number[]; cy: number[] } {
  const lab = new Int32Array(w * h); const sizes: number[] = [0]; const sx: number[] = [0], sy: number[] = [0];
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    n++; lab[i] = n; sizes.push(0); sx.push(0); sy.push(0); stack.push(i);
    while (stack.length) {
      const j = stack.pop()!; sizes[n]++; sx[n] += j % w; sy[n] += (j / w) | 0;
      const x = j % w;
      if (x > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = n; stack.push(j - 1); }
      if (x < w - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = n; stack.push(j + 1); }
      if (j >= w && mask[j - w] && !lab[j - w]) { lab[j - w] = n; stack.push(j - w); }
      if (j + w < w * h && mask[j + w] && !lab[j + w]) { lab[j + w] = n; stack.push(j + w); }
    }
  }
  return { lab, sizes, cx: sx.map((v, i) => (sizes[i] ? v / sizes[i] : 0)), cy: sy.map((v, i) => (sizes[i] ? v / sizes[i] : 0)) };
}

interface Track { pts: { t: number; x: number; y: number }[]; miss: number }

export class LaunchEvidence {
  private prevY: Int16Array | null = null;
  private w = 0; private h = 0;
  private tracks: Track[] = [];
  readonly samples: EvidenceSample[] = [];
  readonly launches: Launch[] = [];
  private exclude: Box[];
  /** exclude: boxes where balls arrive or pile up (the hive cells), in frame coordinates */
  constructor(exclude: Box[] = []) { this.exclude = exclude; }

  push(t: number, f: Frame, robots: RobotBoxAt[]) {
    if (this.w !== f.width || this.h !== f.height) { this.w = f.width; this.h = f.height; this.prevY = null; this.tracks = []; }
    const w = this.w, h = this.h, Y = new Int16Array(w * h);
    yellowness(f, Y);
    const prev = this.prevY; this.prevY = Y;
    if (!prev) return;
    const d = f.data, mask = new Uint8Array(w * h), ymax = Math.floor(0.78 * h);
    for (let i = 0, p = 0; i < w * ymax; i++, p += 4) {
      if (Y[i] - prev[i] > 12 && d[p] > 120 && d[p + 1] > 110 && d[p + 2] < 0.8 * d[p + 1]) mask[i] = 1;
    }
    const clear = (b: Box) => {
      const x0 = Math.max(0, Math.floor(b.x)), x1 = Math.min(w, Math.ceil(b.x + b.w)), y0 = Math.max(0, Math.floor(b.y)), y1 = Math.min(h, Math.ceil(b.y + b.h));
      for (let y = y0; y < y1; y++) mask.fill(0, y * w + x0, y * w + x1);
    };
    for (const b of this.exclude) clear(b);
    for (const r of robots) clear(r.box);                       // balls carried inside a robot, its lights
    const k = (w / 1920) ** 2, MAX_BLOB = MAX_BLOB_1080 * k, MIN_BLOB = Math.max(3, 6 * k), G = w / 1920;
    const { lab, sizes, cx, cy } = label(mask, w, h);
    const big = new Uint8Array(sizes.length);
    sizes.forEach((s, i) => { if (s > MAX_BLOB) big[i] = 1; });
    // per robot: pixels and blobs in the window above it
    const above = new Map<number, { px: number; blobs: number }>();
    for (const r of robots) {
      const s = r.box.h / 0.9, top = r.box.y, cxr = r.box.x + r.box.w / 2;
      const x0 = Math.max(0, Math.floor(cxr - 0.6 * s)), x1 = Math.min(w, Math.ceil(cxr + 0.6 * s));
      const y0 = Math.max(0, Math.floor(top - 1.2 * s)), y1 = Math.min(h, Math.ceil(top + 0.1 * s));
      let px = 0; const seen = new Set<number>();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const l = lab[y * w + x];
        if (l && !big[l]) { px++; seen.add(l); }
      }
      above.set(r.id, { px, blobs: seen.size });
    }
    this.samples.push({ t, above });
    // blobs → tracks (forward linking with a constant-velocity guess)
    const blobs: { x: number; y: number }[] = [];
    for (let i = 1; i < sizes.length; i++) if (sizes[i] >= MIN_BLOB && !big[i]) blobs.push({ x: cx[i], y: cy[i] });
    const used = new Set<number>();
    for (const tr of this.tracks) {
      const n = tr.pts.length, last = tr.pts[n - 1];
      let px = last.x, py = last.y;
      if (n > 1) { px = 2 * last.x - tr.pts[n - 2].x; py = 2 * last.y - tr.pts[n - 2].y; }
      const gate = (n > 1 ? 40 : 70) * G;
      let best = gate, bj = -1;
      blobs.forEach((b, j) => { if (!used.has(j)) { const dd = Math.hypot(b.x - px, b.y - py); if (dd < best) { best = dd; bj = j; } } });
      if (bj >= 0) { used.add(bj); tr.pts.push({ t, ...blobs[bj] }); tr.miss = 0; } else tr.miss++;
    }
    const keep: Track[] = [];
    for (const tr of this.tracks) { if (tr.miss > 1) this.finish(tr, robots); else keep.push(tr); }
    this.tracks = keep;
    blobs.forEach((b, j) => { if (!used.has(j)) this.tracks.push({ pts: [{ t, ...b }], miss: 0 }); });
  }

  /** Call when the burst ends. */
  flush(robots: RobotBoxAt[]) { for (const tr of this.tracks) this.finish(tr, robots); this.tracks = []; }

  private finish(tr: Track, robots: RobotBoxAt[]) {
    const P = tr.pts;
    if (P.length < 3) return;
    const a = P[0], b = P[P.length - 1];
    const G = this.w / 1920;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 50 * G || b.y > a.y + 10 * G) return;   // must travel and rise
    let best: { d: number; id: number } | null = null;
    for (const r of robots) {
      const s = r.box.h / 0.9;
      if (a.x >= r.box.x - 0.3 * s && a.x <= r.box.x + r.box.w + 0.3 * s && a.y >= r.box.y - 1.3 * s && a.y <= r.box.y + 0.3 * s) {
        const d = Math.abs(a.x - (r.box.x + r.box.w / 2)) / s + Math.max(0, r.box.y - a.y) / s;
        if (!best || d < best.d) best = { d, id: r.id };
      }
    }
    if (best) this.launches.push({ t: a.t, robot: best.id, x: a.x, y: a.y, points: P.length });
  }
}
