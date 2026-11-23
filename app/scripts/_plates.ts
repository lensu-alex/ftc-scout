// Dev: can team-number plates be read from 1080p robot crops? (optional cue, never relied on)
// usage: tsx scripts/_plates.ts <clip1080> <clipStartInMatch> <robots.json> <t> [t...]
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { readFrames } from "../helper/ffmpeg";
const [clip, cs, robPath, ...ts] = process.argv.slice(2);
const cstart = +cs, R = JSON.parse(readFileSync(robPath, "utf8")), st = R.start, SC = 1.5;
const worker = await createWorker("eng", 1, { langPath: ".", gzip: false, logger: () => {} });
await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "7" as never });
for (const tS of ts) {
  const t = +tS;
  for await (const { frame } of readFrames(clip, 30, t - cstart, 1 / 30, { w: 1920, h: 1080 })) {
    for (const r of R.robots) {
      const q = r.path.reduce((a: { t: number }, b: { t: number }) => (Math.abs(b.t - (st + t)) < Math.abs(a.t - (st + t)) ? b : a));
      if (Math.abs(q.t - (st + t)) > 0.6) continue;
      const s = q.s * SC, x0 = Math.max(0, Math.round(q.x * SC - 0.6 * s)), y0 = Math.max(0, Math.round(q.y * SC - 0.95 * s));
      const w = Math.min(1920 - x0, Math.round(1.2 * s)), h = Math.min(1080 - y0, Math.round(1.0 * s));
      if (w < 10 || h < 10) continue;
      const png = await sharp(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.length), { raw: { width: 1920, height: 1080, channels: 4 } })
        .extract({ left: x0, top: y0, width: w, height: h }).resize({ width: w * 4, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer();
      const { data } = await worker.recognize(png);
      const txt = data.text.replace(/\s+/g, "");
      const hits = txt.match(/\d{4,5}/g) ?? [];
      console.log(`t=${t} robot ${r.id} @(${Math.round(q.x)},${Math.round(q.y)}) → "${txt}" ${hits.length ? "digits " + hits.join(",") : ""} conf ${Math.round(data.confidence)}`);
    }
    break;
  }
}
await worker.terminate();
