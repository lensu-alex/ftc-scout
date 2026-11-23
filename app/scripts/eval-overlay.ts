// Runs the score-bar detector over every sampled frame in tools/dataset and writes debug sheets.
import { readdirSync, mkdirSync } from "node:fs";
import { loadFrame, annotate, sheet } from "./load";
import { findScoreBar } from "../src/vision/overlay";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { frameToPng } from "./load";

const reader = new TinyOverlayReader();
await reader.init();

const root = new URL("../../tools/dataset/", import.meta.url).pathname;
const out = new URL("../../tools/debug/overlay/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
let found = 0, total = 0;
for (const s of readdirSync(root)) {
  const files = readdirSync(root + s).filter(f => /^f\d+\.jpg$/.test(f)).sort();
  const tiles: Buffer[] = [];
  for (const f of files) {
    const p = `${root}${s}/${f}`;
    const t0 = performance.now();
    const frame = await loadFrame(p);
    const bar = findScoreBar(frame);
    const ms = performance.now() - t0;
    let ocr = "";
    if (bar) {
      const c = await reader.readClock(frame, bar), n = await reader.readMatchName(frame, bar);
      ocr = ` ${c === null ? "?" : `${Math.floor(c / 60)}:${String(c % 60).padStart(2, "0")}`} ${n ? `${n.level[0]}${n.number}` : "?"}`;
    }
    total++; if (bar) found++;
    const boxes = bar ? [{ b: bar.timer, color: "lime" }, { b: bar.bar, color: "yellow" }, { b: bar.matchName, color: "magenta" }] : [];
    tiles.push(await annotate(p, boxes, `${s} ${f} ${bar ? "BAR" : "-"}${ocr}`));
  }
  await sheet(tiles, `${out}${s}.jpg`);
}
console.log(`score bar found in ${found}/${total} frames`);
await reader.close();
