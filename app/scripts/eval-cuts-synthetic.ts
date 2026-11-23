// Synthetic multi-camera test: alternate two different streams every 15 s and check that
// every switch is found as a cut and the shots fall into exactly two camera views.
import { ShotTracker, fingerprint } from "../src/vision/shots";
import { findScoreBar } from "../src/vision/overlay";
import { readFrames } from "../helper/ffmpeg";
import type { Frame } from "../src/vision/frame";

async function grabAll(clip: string, from: number, dur: number) {
  const out: Frame[] = [];
  for await (const { frame } of readFrames(clip, 3, from, dur)) out.push(frame);
  return out;
}
const a = await grabAll("../tools/clips/USMICOQ_8530.mp4", 20, 90);
const b = await grabAll("../tools/clips/USIADAIM1_5100.mp4", 80, 90);
const tr = new ShotTracker();
let truth = 0, found = 0, falseCuts = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  const useA = Math.floor(i / 45) % 2 === 0; // 45 frames = 15 s at 3 fps
  const f = useA ? a[i] : b[i];
  const bar = findScoreBar(f);
  const { cut } = tr.push(i / 3, fingerprint(f, bar ? [bar.bar, bar.banner] : []));
  const isSwitch = i > 0 && i % 45 === 0;
  if (isSwitch) truth++;
  if (cut && i > 0) { if (isSwitch) found++; else falseCuts++; }
}
console.log(`switches ${truth}, found ${found}, false cuts ${falseCuts}, views ${tr.views.length}, shots ${tr.shots.length}`);
console.log(tr.shots.map(s => `v${s.view}@${s.start.toFixed(0)}`).join(" "));
