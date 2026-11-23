// For each training frame, write where the FTC Live overlay is (so pre-labelling can ignore it).
import { readdirSync, writeFileSync } from "node:fs";
import { loadFrame } from "./load";
import { findScoreBar } from "../src/vision/overlay";
const dir = "../tools/dataset/train_raw/";
const out: Record<string, number[][]> = {};
for (const f of readdirSync(dir).filter(f => f.endsWith(".jpg"))) {
  const bar = findScoreBar(await loadFrame(dir + f));
  // bar + banner as [x0, y0, x1, y1]; the overlay spans the frame width in practice
  out[f] = bar ? [[0, bar.banner.y, 1280, bar.bar.y + bar.bar.h]] : [];
}
writeFileSync("../tools/dataset/train_overlay.json", JSON.stringify(out));
console.log(Object.keys(out).length, "frames,", Object.values(out).filter(v => v.length).length, "with overlay");
