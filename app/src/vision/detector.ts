import type { Box, Frame } from "./frame";

// Small YOLO detector (robot / pollen / nectar). The model runs through ONNX Runtime: the
// Web build in the browser, the Node build in the helper. This file only does the cheap
// parts around it (letterbox in, decode + non-max suppression out), so both share it.

export const CLASSES = ["robot", "pollen", "nectar_red", "nectar_blue"] as const;
export type DetClass = (typeof CLASSES)[number];

export interface Detection extends Box { cls: DetClass; score: number }

/** Runs the model on a CHW float32 tensor of size 3 x S x S; returns the raw [4 + nc, N] output. */
export type Infer = (input: Float32Array, size: number) => Promise<{ data: Float32Array; dims: readonly number[] }>;

export interface DetectOptions {
  size: number;              // model input size (square)
  roi?: Box;                 // only look inside this part of the frame (the field)
  minScore: Partial<Record<DetClass, number>>;
}

const DEFAULT_MIN: Record<DetClass, number> = { robot: 0.35, pollen: 0.3, nectar_red: 0.3, nectar_blue: 0.3 };

export async function detect(f: Frame, infer: Infer, opts: DetectOptions): Promise<Detection[]> {
  const roi = opts.roi ?? { x: 0, y: 0, w: f.width, h: f.height };
  const S = opts.size;
  const scale = Math.min(S / roi.w, S / roi.h);
  const nw = Math.round(roi.w * scale), nh = Math.round(roi.h * scale);
  const padX = (S - nw) / 2, padY = (S - nh) / 2;
  const input = new Float32Array(3 * S * S).fill(114 / 255);
  // letterbox (nearest neighbour; the model is trained on similar resizes)
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(f.height - 1, Math.floor(roi.y + (y + 0.5) / scale));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(f.width - 1, Math.floor(roi.x + (x + 0.5) / scale));
      const p = (sy * f.width + sx) * 4, o = (y + Math.floor(padY)) * S + x + Math.floor(padX);
      input[o] = f.data[p] / 255;
      input[S * S + o] = f.data[p + 1] / 255;
      input[2 * S * S + o] = f.data[p + 2] / 255;
    }
  }
  const out = await infer(input, S);
  const [, rows, n] = out.dims.length === 3 ? out.dims : [1, out.dims[0], out.dims[1]];
  const nc = rows - 4;
  const min = { ...DEFAULT_MIN, ...opts.minScore };
  const dets: Detection[] = [];
  for (let i = 0; i < n; i++) {
    let best = 0, cls = 0;
    for (let c = 0; c < nc; c++) {
      const s = out.data[(4 + c) * n + i];
      if (s > best) { best = s; cls = c; }
    }
    const name = CLASSES[cls];
    if (!name || best < min[name]) continue;
    const cx = out.data[i], cy = out.data[n + i], w = out.data[2 * n + i], h = out.data[3 * n + i];
    dets.push({
      cls: name, score: best,
      x: roi.x + (cx - w / 2 - padX) / scale, y: roi.y + (cy - h / 2 - padY) / scale, w: w / scale, h: h / scale,
    });
  }
  return nms(dets, 0.5);
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

function nms(d: Detection[], thr: number): Detection[] {
  d.sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const x of d) if (!keep.some(k => k.cls === x.cls && iou(k, x) > thr)) keep.push(x);
  return keep;
}

/**
 * Whole frame + two zoomed tiles over the far part of the picture (the upper share `far` of the
 * region). Far robots are small: in the whole frame, shrunk to the model size, a robot on the far
 * side is ~15 px; in a tile it is about twice that. Results are merged; a box cut by a tile edge
 * gives way to a bigger box of the same thing that contains most of it.
 */
export async function detectTiled(f: Frame, infer: Infer, opts: DetectOptions, far = 0.6): Promise<Detection[]> {
  const roi = opts.roi ?? { x: 0, y: 0, w: f.width, h: f.height };
  const whole = await detect(f, infer, opts);
  const th = Math.round(roi.h * far), tw = Math.round(roi.w * 0.55);
  const tiles = [{ x: roi.x, y: roi.y, w: tw, h: th }, { x: roi.x + roi.w - tw, y: roi.y, w: tw, h: th }];
  const parts = [...whole];
  for (const t of tiles) parts.push(...await detect(f, infer, { ...opts, roi: t }));
  const keep: Detection[] = [];
  for (const d of parts.sort((a, b) => b.score - a.score)) {
    if (keep.some(k => k.cls === d.cls && (iou(k, d) > 0.5 || inside(d, k) > 0.6))) continue;
    keep.push(d);
  }
  return keep;
}

/** Share of a that lies inside b. */
function inside(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (a.w * a.h || 1) : 0;
}
