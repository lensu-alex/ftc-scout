// Learns glyph templates for the tiny overlay reader from real frames, using Tesseract's readings
// as labels (dev only: the app itself never loads Tesseract). Writes src/vision/templates.json.
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { loadFrame, frameToPng } from "./load";
import { findScoreBar, timerDigits } from "../src/vision/overlay";
import { OverlayReader } from "./tesseractReader";
import { crop } from "../src/vision/frame";
import { glyphs, words, GW, GH, type Glyph } from "../src/vision/glyphs";

const root = "../tools/dataset/";
const files: string[] = [];
for (const s of readdirSync(root)) {
  for (const sub of ["", "seq/", "train_raw/"]) {
    const d = `${root}${s}/${sub}`;
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".jpg") && f !== "sheet.jpg") files.push(d + f);
  }
}
for (const f of readdirSync(`${root}train_raw`)) files.push(`${root}train_raw/${f}`);

const reader = new OverlayReader(f => frameToPng(f).toBuffer());
await reader.init();
const acc: Record<string, { sum: Float32Array; n: number }> = {};
const add = (key: string, g: Glyph) => {
  acc[key] ??= { sum: new Float32Array(GW * GH), n: 0 };
  for (let i = 0; i < g.bmp.length; i++) acc[key].sum[i] += g.bmp[i];
  acc[key].n++;
};
let used = 0;
for (const p of [...new Set(files)]) {
  const f = await loadFrame(p).catch(() => null);
  if (!f || f.width !== 1280) continue;
  const bar = findScoreBar(f);
  if (!bar) continue;
  // clock: "M:SS" → 3 digit glyphs (colon is narrow and dropped)
  const clock = await reader.readClock(f, bar);
  if (clock !== null) {
    const gs = clockGlyphs(crop(f, timerDigits(bar.timer)));
    const label = `${Math.floor(clock / 60)}${String(clock % 60).padStart(2, "0")}`;
    if (gs.length === 3) gs.forEach((g, i) => add(`c${label[i]}`, g));
  }
  // banner: label every word whose glyph count matches the text
  const name = await reader.readMatchName(f, bar);
  if (name) {
    const ws = words(glyphs(crop(f, bar.matchName), false, 0.3));
    // the overlay font draws "fi" as one glyph
    const tw = name.raw.split(" ").map(w => w.replace(/fi/g, "\u00a7"));
    if (ws.length === tw.length) {
      ws.forEach((w, i) => { if (w.length === tw[i].length) w.forEach((g, j) => add(`b${tw[i][j]}`, g)); });
    }
  }
  used++;
}
await reader.close();
const out: Record<string, string> = {};
for (const [k, v] of Object.entries(acc)) {
  if (v.n < 2) continue;
  out[k] = Buffer.from(Uint8Array.from(v.sum, x => Math.round((x / v.n) * 255))).toString("base64");
}
writeFileSync("src/vision/templates.json", JSON.stringify(out));
console.log(`frames used ${used}; templates:`, Object.entries(acc).map(([k, v]) => `${k}:${v.n}`).sort().join(" "));

export function clockGlyphs(c: ReturnType<typeof crop>) {
  return glyphs(c, true, 0.45, false).filter(g => (g.x1 - g.x0 + 1) / (g.y1 - g.y0 + 1) > 0.3);
}
