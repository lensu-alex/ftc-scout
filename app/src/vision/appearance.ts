import type { Box, Frame } from "./frame";

// What a robot looks like, independent of its alliance: crops are embedded with a small
// image model after the red/blue alliance markings are greyed out (they switch colour from
// match to match). The same crop also tells which alliance the robot is on.

export const EMBED_SIZE = 128;

/** Runs the embedding model on a 1x3xSxS tensor; returns the raw feature vector. */
export type EmbedInfer = (input: Float32Array, size: number) => Promise<Float32Array>;

function isRed(h: number, s: number, v: number) { return s > 0.45 && v > 0.3 && (h < 15 || h > 340); }
// (blue plates come out washed-out on stream video: measured ~s 0.42, v 0.35 on a clean stream)
function isBlue(h: number, s: number, v: number) { return s > 0.3 && v > 0.2 && h > 195 && h < 255; }

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, mx ? d / mx : 0, mx / 255];
}

/** Share of strongly red vs blue pixels in the robot's box: its alliance markings. */
export function allianceColour(f: Frame, b: Box): { red: number; blue: number } {
  let red = 0, blue = 0, n = 0;
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(f.width, Math.ceil(b.x + b.w)), y1 = Math.min(f.height, Math.ceil(b.y + b.h));
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const p = (y * f.width + x) * 4;
    const [h, s, v] = hsv(f.data[p], f.data[p + 1], f.data[p + 2]);
    if (isRed(h, s, v)) red++; else if (isBlue(h, s, v)) blue++;
    n++;
  }
  return { red: red / (n || 1), blue: blue / (n || 1) };
}

/** Robot crop → model input, with alliance-coloured pixels turned grey. */
export function embedInput(f: Frame, b: Box): Float32Array {
  const S = EMBED_SIZE, out = new Float32Array(3 * S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = Math.min(f.width - 1, Math.max(0, Math.floor(b.x + ((x + 0.5) * b.w) / S)));
    const sy = Math.min(f.height - 1, Math.max(0, Math.floor(b.y + ((y + 0.5) * b.h) / S)));
    const p = (sy * f.width + sx) * 4;
    let r = f.data[p], g = f.data[p + 1], bl = f.data[p + 2];
    const [h, s, v] = hsv(r, g, bl);
    if (isRed(h, s, v) || isBlue(h, s, v)) r = g = bl = Math.round(v * 255 * 0.6);
    const o = y * S + x;
    out[o] = r / 255; out[S * S + o] = g / 255; out[2 * S * S + o] = bl / 255;
  }
  return out;
}

export async function embed(f: Frame, b: Box, infer: EmbedInfer): Promise<Float32Array> {
  const e = await infer(embedInput(f, b), EMBED_SIZE);
  let n = 0;
  for (const x of e) n += x * x;
  n = Math.sqrt(n) || 1;
  return e.map(x => x / n);
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Average several embeddings of the same robot (several crops = steadier). */
export function meanEmbedding(es: Float32Array[]): Float32Array {
  const m = new Float32Array(es[0].length);
  for (const e of es) for (let i = 0; i < m.length; i++) m[i] += e[i];
  let n = 0;
  for (const x of m) n += x * x;
  n = Math.sqrt(n) || 1;
  return m.map(x => x / n);
}
