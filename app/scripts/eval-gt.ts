// Robot detection + tracking against hand/agent-annotated frames (tools/gt: index.json, frames/, labels/<clip>.json).
// usage: tsx scripts/eval-gt.ts [det|track] [clip,clip]   env: FTC_DET (model), FTC_TILES=0|1, THR (score, default 0.35)
// det:   the detector alone on each annotated frame (recall near/far, precision)
// track: the whole analysis on each clip; at each annotated moment, is there a robot track on each robot?
import { readFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { detect, detectTiled, iou, type Detection } from "../src/vision/detector";
import { findScoreBar } from "../src/vision/overlay";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { readFrames } from "../helper/ffmpeg";
import type { Box, Frame } from "../src/vision/frame";

const GT = "../tools/gt";
const [mode = "det", only] = process.argv.slice(2);
const THR = +(process.env.THR ?? 0.35), TILES = process.env.FTC_TILES === "1";
type GtBox = { box: [number, number, number, number]; far?: boolean; hidden?: boolean };
const index: { id: string; clip: string; t: number }[] = JSON.parse(readFileSync(`${GT}/index.json`, "utf8"));
const clips = [...new Set(index.map(f => f.clip))].filter(c => !only || only.split(",").includes(c));
const labels = (c: string): Record<string, GtBox[]> | null => existsSync(`${GT}/labels/${c}.json`) ? JSON.parse(readFileSync(`${GT}/labels/${c}.json`, "utf8")) : null;
const CLIPS: Record<string, [string, number]> = {
  or9: ["../tools/clips/or9.webm", 10], or18: ["../tools/clips/or18.mp4.webm", 14], nlron: ["../tools/clips/NLRON_13760.mp4", 0],
  micoq: ["../tools/clips/USMICOQ_8530.mp4", 21], m1: ["../tools/clips/m1.mp4", 19],
};

const toBox = (g: GtBox): Box => ({ x: g.box[0], y: g.box[1], w: g.box[2] - g.box[0], h: g.box[3] - g.box[1] });
const hit = (g: Box, d: Box) => iou(g, d) >= 0.3 || (d.x + d.w / 2 >= g.x && d.x + d.w / 2 <= g.x + g.w && d.y + d.h / 2 >= g.y && d.y + d.h / 2 <= g.y + g.h);

/** Greedy one-to-one matching; returns matched gt flags and the number of unmatched detections. */
function score(gt: GtBox[], dets: Box[]) {
  const used = new Set<number>(), found = gt.map(() => false);
  gt.forEach((g, i) => {
    const gb = toBox(g);
    let best = -1, bi = -1;
    dets.forEach((d, k) => { if (!used.has(k) && hit(gb, d)) { const v = iou(gb, d) + 0.01; if (v > best) { best = v; bi = k; } } });
    if (bi >= 0) { used.add(bi); found[i] = true; }
  });
  return { found, fp: dets.length - used.size };
}

async function load(id: string): Promise<Frame> {
  const { data, info } = await sharp(`${GT}/frames/${id}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

type Tally = { n: number; tp: number; far: number; farTp: number; near: number; nearTp: number; fp: number; dets: number };
const tally = (): Tally => ({ n: 0, tp: 0, far: 0, farTp: 0, near: 0, nearTp: 0, fp: 0, dets: 0 });
function add(t: Tally, gt: GtBox[], r: { found: boolean[]; fp: number }, ndet: number) {
  gt.forEach((g, i) => {
    t.n++; if (r.found[i]) t.tp++;
    if (g.far) { t.far++; if (r.found[i]) t.farTp++; } else { t.near++; if (r.found[i]) t.nearTp++; }
  });
  t.fp += r.fp; t.dets += ndet;
}
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const line = (name: string, t: Tally) =>
  `${name.padEnd(6)} recall ${pct(t.tp, t.n)} (near ${pct(t.nearTp, t.near)}, far ${pct(t.farTp, t.far)}) precision ${pct(t.dets - t.fp, t.dets)} | ${t.n} robots`;

const all = tally();
const fpLog: { id: string; gt: GtBox[]; fps: Detection[] }[] = [];
for (const c of clips) {
  const L = labels(c);
  if (!L) { console.log(`${c}: no labels yet`); continue; }
  const t = tally();
  if (mode === "det") {
    for (const f of index.filter(f => f.clip === c)) {
      const gt = L[f.id] ?? [];
      const fr = await load(f.id);
      const bar = findScoreBar(fr);
      const roi = bar ? (bar.bar.y > fr.height / 2 ? { x: 0, y: 0, w: fr.width, h: bar.banner.y } : { x: 0, y: bar.bar.y + bar.bar.h, w: fr.width, h: fr.height - bar.bar.y - bar.bar.h }) : undefined;
      const d: Detection[] = (await (TILES ? detectTiled : detect)(fr, nodeInfer, { size: detectorSize(), roi, minScore: { robot: THR } })).filter(x => x.cls === "robot");
      const r = score(gt, d); add(t, gt, r, d.length); add(all, gt, r, d.length);
      if (process.env.SHOW_FP) {
        const fps = d.filter(x => !gt.some(g => hit(toBox(g), x)));
        if (fps.length) fpLog.push({ id: f.id, gt, fps });
      }
    }
  } else {
    const [path, start] = CLIPS[c];
    async function* frames() { yield* readFrames(path, 10, Math.max(0, start - 2), 165); }
    const a = await analyzeMatch(frames(), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: TILES });
    for (const f of index.filter(f => f.clip === c)) {
      const gt = L[f.id] ?? [];
      // the frame was taken at clip time start + t; analysis times are clip times too
      const tt = start + f.t;
      const boxes = a.robots.flatMap(r => {
        const p = r.path.reduce((x, y) => (Math.abs(y.t - tt) < Math.abs(x.t - tt) ? y : x));
        return Math.abs(p.t - tt) <= 0.5 ? [{ x: p.x - p.s / 2, y: p.y - 0.8 * p.s, w: p.s, h: 0.8 * p.s }] : []; // (bottom-centre + size → approx box)
      });
      const r = score(gt, boxes); add(t, gt, r, boxes.length); add(all, gt, r, boxes.length);
    }
  }
  console.log(line(c, t));
}
console.log(line("ALL", all));

if (process.env.SHOW_FP) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${GT}/fp.json`, JSON.stringify(fpLog));
  console.log(`false positives written for ${fpLog.length} frames`);
}
