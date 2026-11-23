import { readFrames } from "../helper/ffmpeg";
import { nodeInfer } from "../helper/detector";
import { detect } from "../src/vision/detector";
import { findScoreBar } from "../src/vision/overlay";
const [clip, s] = process.argv.slice(2);
const hist = [0,0,0,0,0,0,0], scores: number[] = [];
for await (const { t, frame } of readFrames(clip, 1, +s + 5, 150)) {
  const bar = findScoreBar(frame);
  const roi = bar ? { x: 0, y: 0, w: frame.width, h: bar.banner.y } : undefined;
  const d = (await detect(frame, nodeInfer, { size: 640, roi, minScore: { robot: 0.05 } as any })).filter(x => x.cls === "robot");
  d.forEach(x => scores.push(x.score));
  hist[Math.min(6, d.filter(x => x.score >= 0.25).length)]++;
}
console.log("robots/frame (>=0.25):", hist.join(" "));
const b = [0.05,0.1,0.15,0.2,0.25,0.35,0.5,0.7].map(th => `${th}:${(scores.filter(x=>x>=th).length/150).toFixed(2)}`);
console.log("avg robots/frame by threshold", b.join(" "));
