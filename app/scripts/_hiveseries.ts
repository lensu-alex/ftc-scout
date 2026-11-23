// Dev: per-second yellow area inside a hive box (with robot boxes from the analysis excluded).
// usage: tsx scripts/_hiveseries.ts <clip> <start> x0,y0,x1,y1
import { readFrames } from "../helper/ffmpeg";
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
import { HiveWatcher, type HiveSample } from "../src/vision/hive";
const [clip, s, boxS] = process.argv.slice(2); const start = +s; const [x0, y0, x1, y1] = boxS.split(",").map(Number);
const a = await analyzeMatch(readFrames(clip, 10, Math.max(0, start - 3), 165), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: true });
const w = new HiveWatcher({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); const S: HiveSample[] = [];
for await (const { t, frame } of readFrames(clip, 10, Math.max(0, start - 3), 165)) {
  const tt = t - start;
  const robots = a.robots.flatMap(r => { let b = r.path[0]; for (const p of r.path) if (Math.abs(p.t - t) < Math.abs(b.t - t)) b = p; return Math.abs(b.t - t) <= 0.4 ? [{ x: b.x - b.s / 2, y: b.y - 0.9 * b.s, w: b.s, h: 0.9 * b.s }] : []; });
  if (tt < -0.5) w.learnStill(frame); else S.push(w.push(tt, frame, robots));
}
const sec: number[] = [];
for (const x of S) { const k = Math.floor(x.t); if (k >= 0) sec[k] = Math.max(sec[k] ?? 0, x.area); }
console.log(sec.map((v, i) => `${i}:${v}`).join(" "));
