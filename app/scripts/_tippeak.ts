// Dev: at each hive tip, the row swings into view: peak yellow area just before the drop vs balls known from marks.
import { readFrames } from "../helper/ffmpeg";
import { HiveWatcher, hiveEvents, type HiveSample } from "../src/vision/hive";
const [clip, startS, boxS] = process.argv.slice(2);
const start = +startS, [x0, y0, x1, y1] = boxS.split(",").map(Number);
const w = new HiveWatcher({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
const S: HiveSample[] = [];
for await (const { t, frame } of readFrames(clip, 10, Math.max(0, start - 3), 163)) { if (t < start - 0.5) w.learnStill(frame); else S.push(w.push(t - start, frame)); }
const { events } = hiveEvents(S, 100);
let since = 0, lastTip = -1;
for (const e of events) {
  if (e.kind === "scored") { since += e.balls!; continue; }
  const win = S.filter(s => s.t >= e.t - 2.5 && s.t <= e.t + 1.5);
  const peak = Math.max(...win.map(s => s.area));
  console.log(`tip at ${e.t.toFixed(1).padStart(6)}: level before ${Math.round(e.from)} (${(e.from / 100).toFixed(1)} balls), peak ${peak} (${(peak / 100).toFixed(1)}), volleys since last tip summed ${since}`);
  since = 0; lastTip = e.t;
}
