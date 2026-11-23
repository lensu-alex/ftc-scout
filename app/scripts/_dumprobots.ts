// Dev: robot tracks of a clip → JSON (for the launch-counting experiments in tools/).
// usage: tsx scripts/_dumprobots.ts <clip> <matchStartInClip> <out.json>
import { writeFileSync } from "node:fs";
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
import { readFrames } from "../helper/ffmpeg";
const [clip, startS, out] = process.argv.slice(2);
const start = +startS;
async function* frames() { yield* readFrames(clip, 10, Math.max(0, start - 2), 165); }
const a = await analyzeMatch(frames(), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: true });
writeFileSync(out, JSON.stringify({
  start, mainView: a.mainView,
  robots: a.robots.map(r => ({ id: r.id, hits: r.hits, red: r.red, blue: r.blue, view: r.view, path: r.path.map(p => ({ t: +p.t.toFixed(2), x: Math.round(p.x), y: Math.round(p.y), s: Math.round(p.s) })), launches: r.launches.map(l => ({ t: +l.t.toFixed(2), strong: l.strong })) })),
}));
console.log(`${a.robots.length} robots → ${out}`);
