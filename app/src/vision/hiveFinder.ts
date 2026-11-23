import type { Box, Frame } from "./frame";

// Where is the hive in this camera view? The hive is two see-saws of red and blue tubes standing side by
// side at the field centre. Pure red tubes are rare in the picture, so the red hive is found first (thin red
// structures near the middle); the blue hive has the same size and stands next to it, on the side where
// blue tube pixels are. Returns boxes in frame pixels, or null when no hive is seen.

export interface HiveBoxes { red: Box; blue: Box }

function thin(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // keep only structures thinner than ~2r: mask minus its opening (erosion then dilation) with a (2r+1)² square
  const er = new Uint8Array(w * h);
  // erosion via separable min: rows then columns
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    for (let k = -r; k <= r && ok; k++) { const xx = x + k; if (xx < 0 || xx >= w || !mask[y * w + xx]) ok = 0; }
    tmp[y * w + x] = ok;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    for (let k = -r; k <= r && ok; k++) { const yy = y + k; if (yy < 0 || yy >= h || !tmp[yy * w + x]) ok = 0; }
    er[y * w + x] = ok;
  }
  // dilation of the erosion = opening; thin = mask & !opening
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    let covered = 0;
    for (let dy = -r; dy <= r && !covered; dy++) for (let dx = -r; dx <= r && !covered; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h && er[yy * w + xx]) covered = 1;
    }
    if (!covered) out[y * w + x] = 1;
  }
  return out;
}

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number }
function components(mask: Uint8Array, w: number, h: number): Comp[] {
  const lab = new Int32Array(w * h); const out: Comp[] = []; const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    const id = out.length + 1; lab[i] = id; stack.push(i);
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    while (stack.length) {
      const j = stack.pop()!, x = j % w, y = (j / w) | 0; c.area++;
      if (x < c.x0) c.x0 = x; if (x + 1 > c.x1) c.x1 = x + 1; if (y < c.y0) c.y0 = y; if (y + 1 > c.y1) c.y1 = y + 1;
      // 8-neighbourhood (stands in for the 1-px dilation used in the experiments)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const k = yy * w + xx;
        if (mask[k] && !lab[k]) { lab[k] = id; stack.push(k); }
      }
    }
    out.push(c);
  }
  return out;
}

export function findHive(f: Frame): HiveBoxes | null {
  const W = f.width, H = f.height, d = f.data;
  const red = new Uint8Array(W * H), blue = new Uint8Array(W * H);
  const yMax = Math.floor(0.8 * H), xMin = Math.floor(0.15 * W), xMax = Math.floor(0.85 * W);
  for (let y = 0; y < yMax; y++) for (let x = xMin; x < xMax; x++) {
    const p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
    if (r > 105 && g < 0.5 * r && b < 0.65 * r) red[y * W + x] = 1;
    if (b > 95 && r < 0.6 * b && g < 0.82 * b && b - r > 60) blue[y * W + x] = 1;
  }
  const R = Math.round(6 * W / 1280);              // tubes are 3-10 px at 720p
  const rt = thin(red, W, H, R);
  const comps = components(rt, W, H).filter(c => Math.max(c.x1 - c.x0, c.y1 - c.y0) >= 18 * W / 1280 && Math.max(c.x1 - c.x0, c.y1 - c.y0) <= 0.4 * W && c.area >= 60 * (W / 1280) ** 2);
  if (!comps.length) return null;
  // group touching components (pad 30% of the group's size); best group = most pixels near the middle
  const groups: Comp[] = [];
  for (const c of comps.sort((a, b) => b.area - a.area)) {
    let placed = false;
    for (const g of groups) {
      const pad = 0.3 * Math.max(g.x1 - g.x0, g.y1 - g.y0, 40 * W / 1280);
      if (c.x1 > g.x0 - pad && c.x0 < g.x1 + pad && c.y1 > g.y0 - pad && c.y0 < g.y1 + pad) {
        g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); g.area += c.area; placed = true; break;
      }
    }
    if (!placed) groups.push({ ...c });
  }
  // a hive is at least ~5% of the picture wide; prefer big outline groups near the middle
  // one see-saw is 5-15% of the picture wide (143 px of 1280 on the Oregon camera, 109 from above)
  const ok = groups.filter(g => g.x1 - g.x0 >= 0.05 * W && g.x1 - g.x0 <= 0.15 * W && g.y1 - g.y0 <= 0.45 * H);
  if (!ok.length) return null;
  // the hive stands above the floor: a red robot or marking low in the picture is not it
  const score = (g: Comp) => g.area / (1 + Math.abs((g.x0 + g.x1) / 2 - W / 2) / (0.2 * W)) * ((g.y0 + g.y1) / 2 < 0.55 * H ? 1 : 0.3);
  const rg = ok.reduce((a, g) => (score(g) > score(a) ? g : a));
  // the outline is often found only in part (a cell, or the tubes facing the camera): a hive is two cells
  // stacked, about 1.3x taller than wide from the side, so the box is grown downwards to that shape
  const rw = rg.x1 - rg.x0;
  if (rg.y1 - rg.y0 < 1.2 * rw) rg.y1 = Math.min(H, rg.y0 + Math.round(1.3 * rw));
  const rh = rg.y1 - rg.y0;
  const bt = thin(blue, W, H, R);
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) n += bt[y * W + x];
    return n;
  };
  let best: { n: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const side of ["L", "R", "U", "D"]) for (let gi = 0; gi <= 6; gi++) {
    const gap = gi * 0.1;
    let bx0: number, by0: number;
    if (side === "L") { bx0 = rg.x0 - rw - gap * rw; by0 = rg.y0; }
    else if (side === "R") { bx0 = rg.x1 + gap * rw; by0 = rg.y0; }
    else if (side === "U") { bx0 = rg.x0; by0 = rg.y0 - rh - gap * rh; }
    else { bx0 = rg.x0; by0 = rg.y1 + gap * rh; }
    const x0 = Math.round(bx0), y0 = Math.round(by0), x1 = Math.round(bx0 + rw), y1 = Math.round(by0 + rh);
    const n = count(x0, y0, x1, y1);
    if (!best || n > best.n) best = { n, x0, y0, x1, y1 };
  }
  const redBox = { x: rg.x0, y: rg.y0, w: rw, h: rh };
  if (!best || best.n < 0.1 * rg.area) return null;
  // tighten the blue box to its tube pixels
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (let y = Math.max(0, best.y0); y < Math.min(H, best.y1); y++) for (let x = Math.max(0, best.x0); x < Math.min(W, best.x1); x++) {
    if (bt[y * W + x]) { if (x < bx0) bx0 = x; if (x + 1 > bx1) bx1 = x + 1; if (y < by0) by0 = y; if (y + 1 > by1) by1 = y + 1; }
  }
  return { red: redBox, blue: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
}
