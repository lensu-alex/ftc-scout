import type { Frame } from "./frame";

// Splits a crop of overlay text into glyphs (characters) and words, and turns each glyph into
// a small fixed-size bitmap for template matching. The overlay always uses the same font, so
// this is all the "OCR" we need: no model, no download.

export const GW = 12, GH = 18; // glyph bitmap size

export interface Glyph { x0: number; x1: number; y0: number; y1: number; bmp: Float32Array }

/** Text pixels (1) vs background (0) with an Otsu threshold; `dark` = dark text on light background. */
export function binarize(f: Frame, dark: boolean): Uint8Array {
  const n = f.width * f.height, lum = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const v = (f.data[i * 4] * 77 + f.data[i * 4 + 1] * 150 + f.data[i * 4 + 2] * 29) >> 8;
    lum[i] = v; hist[v]++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += i * hist[i];
    const d = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (d > best) { best = d; t = i; }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (dark ? lum[i] < t : lum[i] > t) ? 1 : 0;
  return out;
}

interface Comp { x0: number; x1: number; y0: number; y1: number; n: number }

function components(bin: Uint8Array, w: number, h: number): Comp[] {
  const label = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || label[i] >= 0) continue;
    const c: Comp = { x0: w, x1: -1, y0: h, y1: -1, n: 0 };
    const id = comps.length;
    label[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || !bin[q] || label[q] >= 0) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        label[q] = id; stack.push(q);
      }
    }
    comps.push(c);
  }
  return comps;
}

/**
 * Glyphs left to right. Pieces that overlap horizontally (the dot of an i, the two dots of a
 * colon) are merged; specks and things touching the crop's top/bottom edge are dropped.
 */
export function glyphs(f: Frame, dark: boolean, minHeightFrac = 0.25, relative = true): Glyph[] {
  const { width: w, height: h } = f;
  const bin = binarize(f, dark);
  let cs = components(bin, w, h).filter(c => c.n >= 3 && !(c.y0 === 0 && c.y1 === h - 1));
  cs.sort((a, b) => a.x0 - b.x0);
  const merged: Comp[] = [];
  for (const c of cs) {
    const last = merged[merged.length - 1];
    const overlap = last ? Math.min(last.x1, c.x1) - Math.max(last.x0, c.x0) : -1;
    if (last && overlap >= Math.min(c.x1 - c.x0, last.x1 - last.x0) * 0.5) {
      last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
      last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1); last.n += c.n;
    } else merged.push({ ...c });
  }
  // size filter relative to the tallest glyph (lowercase letters are ~half as tall as capitals)
  const tallest = Math.max(0, ...merged.map(c => c.y1 - c.y0 + 1));
  const minH = relative ? tallest * minHeightFrac : h * minHeightFrac;
  cs = merged.filter(c => c.y1 - c.y0 + 1 >= Math.max(3, minH));
  return cs.map(c => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, bmp: bitmap(bin, w, c) }));
}

/** Area-sampled GW x GH bitmap of a glyph box, values 0..1. */
function bitmap(bin: Uint8Array, w: number, c: Comp): Float32Array {
  const out = new Float32Array(GW * GH);
  const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const xa = c.x0 + (gx * bw) / GW, xb = c.x0 + ((gx + 1) * bw) / GW;
    const ya = c.y0 + (gy * bh) / GH, yb = c.y0 + ((gy + 1) * bh) / GH;
    let s = 0, n = 0;
    for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); y++)
      for (let x = Math.floor(xa); x < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); x++) { s += bin[y * w + x]; n++; }
    out[gy * GW + gx] = s / n;
  }
  return out;
}

/** Group glyphs into words by the gaps between them. */
export function words(gs: Glyph[]): Glyph[][] {
  if (!gs.length) return [];
  const gap = Math.max(...gs.map(g => g.y1 - g.y0 + 1)) * 0.3; // ~30% of a capital's height
  const out: Glyph[][] = [[gs[0]]];
  for (let i = 1; i < gs.length; i++) {
    if (gs[i].x0 - gs[i - 1].x1 > gap) out.push([]);
    out[out.length - 1].push(gs[i]);
  }
  return out;
}

/** Similarity of two glyph bitmaps (1 = identical). */
export function match(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return 1 - d / a.length;
}
