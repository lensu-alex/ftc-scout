// dev: can a general OCR read the team number on a robot crop? (feasibility only)
import { createWorker, PSM } from "tesseract.js";
import sharp from "sharp";
const w = await createWorker("eng");
await w.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SPARSE_TEXT });
for (const f of process.argv.slice(2)) {
  const outs: string[] = [];
  for (const neg of [false, true]) {
    let img = sharp(f).resize({ width: 640 }).greyscale().normalise();
    if (neg) img = img.negate();
    const { data } = await w.recognize(await img.png().toBuffer());
    outs.push(data.text.replace(/\s+/g, " ").trim());
  }
  console.log(f.split("/").pop(), "→", outs.join(" | "));
}
await w.terminate();
