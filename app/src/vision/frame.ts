// A frame is plain RGBA pixels, the same shape as the browser's ImageData,
// so every vision module runs unchanged in the browser, in a Web Worker and in Node.
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function crop(f: Frame, b: Box): Frame {
  const x0 = Math.max(0, Math.round(b.x));
  const y0 = Math.max(0, Math.round(b.y));
  const x1 = Math.min(f.width, Math.round(b.x + b.w));
  const y1 = Math.min(f.height, Math.round(b.y + b.h));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * f.width + x0) * 4;
    out.set(f.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

/** Nearest-neighbour resize; good enough for thumbnails and fingerprints. */
export function resize(f: Frame, w: number, h: number): Frame {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(f.height - 1, Math.floor(((y + 0.5) * f.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(f.width - 1, Math.floor(((x + 0.5) * f.width) / w));
      const s = (sy * f.width + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = f.data[s];
      out[d + 1] = f.data[s + 1];
      out[d + 2] = f.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Upscale + turn into black text on white, which OCR engines read best. */
export function toOcrImage(f: Frame, scale: number, darkText: boolean): Frame {
  const w = Math.round(f.width * scale);
  const h = Math.round(f.height * scale);
  const r = resize(f, w, h);
  // Otsu threshold on luminance
  const lum = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const v = (r.data[i * 4] * 77 + r.data[i * 4 + 1] * 150 + r.data[i * 4 + 2] * 29) >> 8;
    lum[i] = v;
    hist[v]++;
  }
  const t = otsu(hist, w * h);
  for (let i = 0; i < w * h; i++) {
    const isText = darkText ? lum[i] < t : lum[i] >= t;
    const v = isText ? 0 : 255;
    r.data[i * 4] = r.data[i * 4 + 1] = r.data[i * 4 + 2] = v;
  }
  return r;
}

function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}
