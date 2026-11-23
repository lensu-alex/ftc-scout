import type { Box, Frame } from "./frame";

// Finds the FTC Live in-match score bar anywhere in the frame, at any scale.
//
// The one layout feature that is the same on every stream: the white match-timer box
// sits directly between a red block (left) and a blue block (right). We look for rows
// with that red | mostly-white | blue pattern, group them, and derive the rest of the
// overlay (bar, banner with the match name) from the timer box geometry.

export interface ScoreBar {
  timer: Box;   // white timer box
  bar: Box;     // full red/blue bar the timer sits in
  banner: Box;  // strip above the bar ("Qualification 3 of 19")
  matchName: Box; // right half of the banner, where the match name is
  redOnLeft: boolean; // some events mirror the overlay (blue | timer | red)
}

const RED = 1, BLUE = 2, WHITE = 3, OTHER = 0;

function classify(r: number, g: number, b: number): number {
  if (r > 200 && g > 200 && b > 200) return WHITE;
  if (r > 130 && r > g * 1.8 && r > b * 1.6) return RED;
  if (b > 110 && b > r * 1.8 && b > g * 1.05) return BLUE;
  return OTHER;
}

interface Run { c: number; x0: number; x1: number } // x1 exclusive

function rowRuns(f: Frame, y: number, cls: Uint8Array): Run[] {
  const { width } = f;
  const base = y * width;
  const runs: Run[] = [];
  let cur = cls[base], start = 0;
  for (let x = 1; x <= width; x++) {
    const c = x < width ? cls[base + x] : 255;
    if (c !== cur) {
      runs.push({ c: cur, x0: start, x1: x });
      cur = c; start = x;
    }
  }
  return runs;
}

interface RowHit { y: number; x0: number; x1: number; redLeft: boolean }

export function findScoreBar(f: Frame): ScoreBar | null {
  const { width, height, data } = f;
  const cls = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < cls.length; i++, p += 4) cls[i] = classify(data[p], data[p + 1], data[p + 2]);

  const minW = width * 0.035, maxW = width * 0.2;
  const hits: RowHit[] = [];
  const frac = (y: number, a: number, b: number, c: number) => {
    a = Math.max(0, Math.round(a)); b = Math.min(width, Math.round(b));
    if (b <= a) return 0;
    let n = 0;
    for (let x = a; x < b; x++) if (cls[y * width + x] === c) n++;
    return n / (b - a);
  };
  for (let y = 0; y < height; y++) {
    const runs = rowRuns(f, y, cls);
    for (let i = 0; i < runs.length; i++) {
      const left = runs[i];
      if ((left.c !== RED && left.c !== BLUE) || left.x1 - left.x0 < 3) continue;
      const other = left.c === RED ? BLUE : RED;
      // walk forward through the middle section until we hit the other alliance colour
      let white = 0, j = i + 1;
      for (; j < runs.length; j++) {
        const r = runs[j];
        if (r.c === BLUE || r.c === RED) break;
        if (r.c === WHITE) white += r.x1 - r.x0;
      }
      if (j >= runs.length || runs[j].c !== other) continue;
      const x0 = left.x1, x1 = runs[j].x0, w = x1 - x0;
      if (w < minW || w > maxW) continue;
      if (white < w * 0.45) continue;
      // score digits break up the blocks, so check the share of colour beside the box
      if (frac(y, x0 - w, x0, left.c) < 0.35 || frac(y, x1, x1 + w, other) < 0.35) continue;
      hits.push({ y, x0, x1, redLeft: left.c === RED });
    }
  }
  if (hits.length === 0) return null;

  // group rows with the same left/right edges (within a few px)
  const groups: RowHit[][] = [];
  for (const h of hits) {
    const g = groups.find(g => {
      const last = g[g.length - 1];
      return last.redLeft === h.redLeft && Math.abs(last.x0 - h.x0) <= 4 && Math.abs(last.x1 - h.x1) <= 4 && h.y - last.y <= 6;
    });
    if (g) g.push(h); else groups.push([h]);
  }
  let best: RowHit[] | null = null;
  for (const g of groups) if (!best || g.length > best.length) best = g;
  if (!best) return null;

  const x0 = median(best.map(h => h.x0)), x1 = median(best.map(h => h.x1));
  const w = x1 - x0;
  // Big digits can break the box into several row groups: merge every hit with the same
  // edges, growing up/down from the best group while the vertical gaps stay small.
  const redOnLeft = best[0].redLeft;
  const same = hits.filter(h => h.redLeft === redOnLeft && Math.abs(h.x0 - x0) <= 4 && Math.abs(h.x1 - x1) <= 4).map(h => h.y);
  let y0 = best[0].y, y1 = best[best.length - 1].y + 1;
  const maxGap = w * 0.6;
  for (const y of [...same].sort((a, b) => b - a)) if (y < y0 && y0 - y <= maxGap) y0 = y;
  for (const y of [...same].sort((a, b) => a - b)) if (y >= y1 && y - y1 <= maxGap) y1 = y + 1;
  best = same.filter(y => y >= y0 && y < y1).map(y => ({ y, x0, x1, redLeft: redOnLeft }));
  const h = y1 - y0;
  if (h < w * 0.45 || h > w * 1.4 || best.length < h * 0.5) return null;

  const timer = { x: x0, y: y0, w, h };
  // The bar has the same height as the timer box; the banner sits on top of it and is
  // ~0.4 bar heights tall. The overlay is ~9.4 timer widths wide, centred on the timer.
  const cx = x0 + w / 2;
  const half = Math.min(w * 4.7, Math.max(cx, width - cx));
  const bar = { x: Math.max(0, cx - half), y: y0, w: Math.min(width, half * 2), h };
  const bh = Math.round(h * 0.42);
  const banner = { x: bar.x, y: Math.max(0, y0 - bh), w: bar.w, h: Math.min(bh, y0) };
  const matchName = { x: cx + w * 0.4, y: banner.y, w: w * 2.6, h: banner.h };
  return { timer, bar, banner, matchName, redOnLeft };
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
}

/** Part of the timer box that holds the digits (skips the small icon at the top). */
export function timerDigits(t: Box): Box {
  return { x: t.x + t.w * 0.04, y: t.y + t.h * 0.3, w: t.w * 0.92, h: t.h * 0.66 };
}
