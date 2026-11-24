// Dev: run pass 1 (detection, tracking, hive) on a clip once and save it, so analysis steps that come after
// (alliances, grouping, attribution inputs) can be iterated on in seconds.
// usage: tsx scripts/cache-pass1.ts <clip720> <start> <out.json>
import { writeFileSync } from "node:fs";
import { readFrames } from "../helper/ffmpeg";
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
const [clip, s, out] = process.argv.slice(2);
const start = +s;
const a = await analyzeMatch(readFrames(clip, 10, Math.max(0, start - 3), 165), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize(), tiles: true, keepHiveSamples: true });
const robots = a.robots.map(r => ({ ...r, embedding: r.embedding ? [...r.embedding] : null, thumb: undefined, crop: undefined }));
writeFileSync(out, JSON.stringify({ start: a.start, mainView: a.mainView, hives: a.hives, hiveEvents: a.hiveEvents, hiveSamples: a.hiveSamples, robots }));
console.log(`saved ${a.robots.length} tracks, ${a.hiveEvents.length} hive events → ${out}`);
