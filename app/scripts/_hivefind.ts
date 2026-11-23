// Dev: the hive finder on a few frames. usage: tsx scripts/_hivefind.ts <png> [...]
import sharp from "sharp";
import { findHive } from "../src/vision/hiveFinder";
for (const p of process.argv.slice(2)) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t0 = Date.now();
  const h = findHive({ width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) });
  console.log(p.split("/").pop(), JSON.stringify(h), `${Date.now() - t0} ms`);
}
