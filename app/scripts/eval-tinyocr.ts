// Tiny reader vs Tesseract on every frame with a score bar: agreement and speed.
import { readdirSync, existsSync } from "node:fs";
import { loadFrame, frameToPng } from "./load";
import { findScoreBar } from "../src/vision/overlay";
import { OverlayReader } from "./tesseractReader";
import { TinyOverlayReader } from "../src/vision/tinyOcr";

const root = "../tools/dataset/";
const files: string[] = [];
for (const s of readdirSync(root)) for (const sub of ["", "seq/"]) {
  const d = `${root}${s}/${sub}`;
  if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith(".jpg") && f !== "sheet.jpg") files.push(d + f);
}
const tess = new OverlayReader(f => frameToPng(f).toBuffer());
await tess.init();
const tiny = new TinyOverlayReader();
let n = 0, clockOk = 0, clockNull = 0, nameOk = 0, nameNull = 0, ms = 0;
const bad: string[] = [];
for (const p of files) {
  const f = await loadFrame(p).catch(() => null);
  if (!f || f.width !== 1280) continue;
  const bar = findScoreBar(f);
  if (!bar) continue;
  const [tc, tn] = [await tess.readClock(f, bar), await tess.readMatchName(f, bar)];
  const t0 = performance.now();
  const [c, nm] = [await tiny.readClock(f, bar), await tiny.readMatchName(f, bar)];
  ms += performance.now() - t0;
  n++;
  if (c === null) clockNull++; else if (c === tc) clockOk++; else bad.push(`${p.split("/").slice(-3).join("/")} clock tiny ${c} tess ${tc}`);
  const tk = tn && `${tn.level[0]}${tn.number}`, k = nm && `${nm.level[0]}${nm.number}`;
  if (k === null) nameNull++; else if (k === tk) nameOk++; else bad.push(`${p.split("/").slice(-3).join("/")} name tiny ${k} tess ${tk}`);
}
await tess.close();
console.log(`frames ${n} | clock agree ${clockOk}, unread ${clockNull}, differ ${n - clockOk - clockNull} | name agree ${nameOk}, unread ${nameNull}, differ ${n - nameOk - nameNull} | ${(ms / n).toFixed(2)} ms/frame`);
console.log(bad.slice(0, 15).join("\n"));
