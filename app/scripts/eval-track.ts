// Tracking quality on a local match clip: detector + tracker (+ track linking), then
// tracks per match (ideally ~4), how long they last, and a picture of the paths.
// usage: tsx scripts/eval-track.ts <clip> <matchStartInClip>
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { readFrames } from "../helper/ffmpeg";
import { detectorSize, nodeInfer, nodeEmbed } from "../helper/detector";
import { frameToPng } from "./load";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { blobLog, candLog, launchDebug, streakLog } from "../src/vision/launches";
launchDebug.on = true;
import { basename } from "node:path";
import type { Frame } from "../src/vision/frame";

const [clip, startArg] = process.argv.slice(2);
const start = +startArg;
let mid: Frame | null = null;
async function* frames() {
  for await (const tf of readFrames(clip, +(process.env.FPS ?? 3), Math.max(0, start - 2), 165)) {
    if (!mid && tf.t > start + 60) mid = tf.frame;
    yield tf;
  }
}
const t0 = Date.now();
const a = await analyzeMatch(frames(), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: process.env.FTC_TILES !== "0" });
const secs = (Date.now() - t0) / 1000;
const lens = a.robots.map(r => r.path[r.path.length - 1].t - r.path[0].t).sort((x, y) => y - x);
console.log(`${basename(clip)}: ${a.robots.length} robot tracks | longest ${lens.slice(0, 6).map(x => x.toFixed(0) + "s").join(" ")} | ` +
  `top-4 cover ${(lens.slice(0, 4).reduce((s, x) => s + x, 0) / (4 * 158) * 100).toFixed(0)}% of 4x158 s | ${secs.toFixed(0)} s to analyse`);
// identity switches show up as impossible jumps: > 1.5 robot lengths in under half a second
let jumps = 0, steps = 0;
for (const r of a.robots) for (let i = 1; i < r.path.length; i++) {
  const p = r.path[i - 1], q = r.path[i], dt = q.t - p.t;
  if (dt > 0.5) continue;
  steps++;
  if (Math.hypot(q.x - p.x, q.y - p.y) > 1.5 * Math.max(p.s, q.s)) jumps++;
}
console.log(`jumps ${jumps}/${steps} (${(jumps / Math.max(1, steps) * 100).toFixed(1)}%)`);
console.log(a.robots.filter(r => r.path.length > 5).map(r => `#${r.id}:${(r.path[0].t - a.start).toFixed(0)}-${(r.path[r.path.length - 1].t - a.start).toFixed(0)}s(${r.hits}) R${r.red.toFixed(2)} B${r.blue.toFixed(2)}`).join(" "));
const L = a.robots.flatMap(r => r.launches.map(l => ({ ...l, id: r.id })));
console.log(`launches ${L.length} (${L.filter(l => l.strong).length} strong):`, a.robots.filter(r => r.launches.length).map(r => `#${r.id}:${r.launches.filter(l => l.strong).length}s+${r.launches.filter(l => !l.strong).length}`).join(" "));
writeFileSync(process.env.LAUNCH_OUT ?? "../tools/debug/launches.json", JSON.stringify({
  start: a.start, launches: L.map(l => ({ ...l, t: l.t - a.start })), streaks: streakLog.map(q => ({ ...q, t: q.t - a.start })), blobs: blobLog.map(q => ({ ...q, t: q.t - a.start })), cands: candLog.map(q => ({ ...q, t: q.t - a.start })),
  tracks: a.robots.map(r => ({ id: r.id, from: r.path[0].t - a.start, to: r.path[r.path.length - 1].t - a.start, launches: r.launches.length })),
}));
const cols = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00", "#ff2d55", "#5ac8fa", "#af52de", "#ff9500"];
const top = [...a.robots].sort((x, y) => y.path.length - x.path.length).slice(0, 8);
const svg = `<svg width="1280" height="720">${L.map(l => `<circle cx="${l.x}" cy="${l.y}" r="9" fill="none" stroke="#fff" stroke-width="3"/>`).join("")}${top.map((r, i) => `<polyline points="${r.path.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${cols[i]}" stroke-width="4"/>`).join("")}</svg>`;
await frameToPng(mid ?? a.views[0].thumb!).composite([{ input: Buffer.from(svg) }]).jpeg().toFile(`../tools/debug/tracks_${basename(clip, ".mp4")}.jpg`);
await sharp; // keep import
