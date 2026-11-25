// dev: balls entering the hive cell at 30 fps around the owner's marked volleys in or1 (blue). Prints, per volley,
// the number of moving ball-sized yellow blobs in the cell per frame. usage: tsx scripts/_entry.ts
import { readFileSync } from "node:fs";
import { readFrames } from "../helper/ffmpeg";
import { label } from "../src/vision/launchEvidence";
const START = 15.5, BOX = { x: 648, y: 0, w: 144, h: 220 };
const marks: { t: number; who: string }[] = JSON.parse(readFileSync("../tools/dataset/launches/USORSFM1-1.json", "utf8"));
const vols = [...new Map(marks.filter(m => m.who === "team").map(m => [m.t, marks.filter(x => x.t === m.t && x.who === "team").length])).entries()];
const yel = (r: number, g: number, b: number) => r > 140 && g > 140 && b < 0.7 * g && r >= 0.8 * g;
for (const [t, k] of vols) {
  let prev: Uint8Array | null = null; const seq: number[] = [];
  for await (const { frame: f } of readFrames("../tools/clips/or1.webm", 30, START + t - 0.3, 2.8)) {
    const m = new Uint8Array(BOX.w * BOX.h);
    for (let y = 0; y < BOX.h; y++) for (let x = 0; x < BOX.w; x++) { const p = ((BOX.y + y) * f.width + BOX.x + x) * 4; m[y * BOX.w + x] = yel(f.data[p], f.data[p + 1], f.data[p + 2]) ? 1 : 0; }
    if (prev) {
      const mv = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) mv[i] = m[i] && !prev[i] ? 1 : 0;
      const { sizes } = label(mv, BOX.w, BOX.h);
      seq.push(sizes.filter((s, i) => i > 0 && s >= 25).length);
    }
    prev = m;
  }
  console.log(`t${t.toFixed(1).padStart(6)} marked ${k}: ${seq.join("")}`);
}
