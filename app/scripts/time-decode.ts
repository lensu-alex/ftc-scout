// How long does reading one match's frames take from a stream URL (no analysis)?
import { readFrames, readFramesParallel } from "../helper/ffmpeg";
import { resolveStream } from "../helper/youtube";
const { url } = await resolveStream(process.argv[2]);
const start = +process.argv[3];
for (const [name, gen] of [["parallel", readFramesParallel(url, 3, start, 165)], ["single", readFrames(url, 3, start, 165)]] as const) {
  const t0 = Date.now(); let n = 0, lastT = -1, bad = 0;
  for await (const { t } of gen) { if (t <= lastT) bad++; lastT = t; n++; }
  console.log(`${name}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s, last t ${lastT.toFixed(2)}, out-of-order ${bad}`);
  if (name === "single" || process.argv[4] === "fast") break;
}
