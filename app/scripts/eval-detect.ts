// Runs the exported detector through the app's own code (helper/detector + src/vision/detector)
// on frames and draws the boxes: checks the model and the TypeScript decoding together.
// usage: tsx scripts/eval-detect.ts <glob-dir> [out-name]
import { readdirSync } from "node:fs";
import { loadFrame, annotate, sheet } from "./load";
import { detect } from "../src/vision/detector";
import { findScoreBar } from "../src/vision/overlay";
import { nodeInfer } from "../helper/detector";

const [dir, name = "detect"] = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith(".jpg")).sort().slice(0, 24);
const col = { robot: "lime", pollen: "yellow", nectar_red: "red", nectar_blue: "deepskyblue" } as const;
const tiles: Buffer[] = [];
let ms = 0;
for (const f of files) {
  const fr = await loadFrame(dir + f);
  const bar = findScoreBar(fr);
  const roi = bar ? (bar.bar.y > 360 ? { x: 0, y: 0, w: 1280, h: bar.banner.y } : { x: 0, y: bar.bar.y + bar.bar.h, w: 1280, h: 720 - bar.bar.y - bar.bar.h }) : undefined;
  const t0 = performance.now();
  const dets = await detect(fr, nodeInfer, { size: 640, roi, minScore: {} });
  ms += performance.now() - t0;
  const n = dets.filter(d => d.cls === "robot").length;
  tiles.push(await annotate(dir + f, dets.map(d => ({ b: d, color: col[d.cls] })), `${f} robots ${n} balls ${dets.length - n}`));
}
await sheet(tiles, `../tools/debug/${name}.jpg`, 4);
console.log(`${files.length} frames, ${(ms / files.length).toFixed(0)} ms per frame (incl. first-run load)`);
