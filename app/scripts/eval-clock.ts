// Reads clock + match name once per second from a local clip and prints the timeline.
// usage: tsx scripts/eval-clock.ts <clip.mp4> [step=1]
import { findScoreBar } from "../src/vision/overlay";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { frameToPng } from "./load";
import { readFrames } from "../helper/ffmpeg";

const [clip, stepArg] = process.argv.slice(2);
const step = +(stepArg ?? 1);
const reader = new TinyOverlayReader();
await reader.init();
let name: string | null = null;
for await (const { t, frame } of readFrames(clip, 1 / step)) {
  const bar = findScoreBar(frame);
  if (!bar) { console.log(t.toFixed(1), "-"); continue; }
  const clock = await reader.readClock(frame, bar);
  if (!name) name = (await reader.readMatchName(frame, bar))?.raw ?? null;
  console.log(t.toFixed(1), clock, name);
}
await reader.close();
