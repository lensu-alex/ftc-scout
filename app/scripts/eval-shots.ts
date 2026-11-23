// Runs the match analysis (clock + camera shots/views) over a local clip and writes a debug sheet:
// one tile per shot (first frame) labelled with time and view id.
// usage: tsx scripts/eval-shots.ts <clip> <matchStartInClip>
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { frameToPng, sheet } from "./load";
import { readFrames } from "../helper/ffmpeg";
import sharp from "sharp";
import { basename } from "node:path";

const [clip, startArg] = process.argv.slice(2);
const reader = new TinyOverlayReader();
await reader.init();
const frames: { t: number; png: Promise<Buffer> }[] = [];
async function* tap() {
  for await (const tf of readFrames(clip, 3)) {
    frames.push({ t: tf.t, png: frameToPng(tf.frame).resize(320, 180).jpeg().toBuffer() });
    yield tf;
  }
}
const a = await analyzeMatch(tap(), +startArg, reader);
console.log(`frames ${a.framesAnalysed}, shots ${a.shots.length}, views ${a.views.length}, main view ${a.mainView} covers ${(a.mainCoverage * 100).toFixed(0)}%`);
for (const v of a.views) console.log(`  view ${v.id}: ${v.seconds.toFixed(1)} s in ${v.shots} shots ${v.live ? "" : "(NOT LIVE)"}`);
const bad = a.clockChecks.filter(c => c.read !== null && Math.abs(c.read - c.expected) > 2);
console.log(`clock checks ${a.clockChecks.length}, unreadable ${a.clockChecks.filter(c => c.read === null).length}, off ${bad.length}`, bad.slice(0, 5));
const tiles: Buffer[] = [];
for (const s of a.shots.slice(0, 40)) {
  const f = frames.find(x => Math.abs(x.t - s.start) < 0.2);
  if (!f) continue;
  const label = `${(s.start - +startArg).toFixed(1)}s v${s.view} (${(s.end - s.start).toFixed(1)}s)`;
  const svg = `<svg width="320" height="180"><rect width="320" height="18" fill="black" opacity="0.7"/><text x="4" y="13" font-size="12" fill="yellow" font-family="Arial">${label}</text></svg>`;
  tiles.push(await sharp(await f.png).composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer());
}
if (tiles.length) await sheet(tiles, `../tools/debug/shots_${basename(clip, ".mp4")}.jpg`, 5, 320);
await reader.close();
