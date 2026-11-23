import { readFrames } from "../helper/ffmpeg";
import { nodeInfer } from "../helper/detector";
import { detect } from "../src/vision/detector";
import { frameToPng } from "./load";
const [clip, s, out] = process.argv.slice(2);
for await (const { frame } of readFrames(clip, 1, +s, 1)) {
  const d = await detect(frame, nodeInfer, { size: 640, minScore: { robot: 0.1 } });
  const svg = `<svg width="1280" height="720">${d.map(b => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${b.cls === "robot" ? "#0f0" : "#f0f"}" stroke-width="${b.cls === "robot" ? 3 : 1}"/>${b.cls === "robot" ? `<text x="${b.x}" y="${b.y - 4}" fill="#0f0" font-size="20">${b.score.toFixed(2)}</text>` : ""}`).join("")}</svg>`;
  await frameToPng(frame).composite([{ input: Buffer.from(svg) }]).jpeg().toFile(out);
  break;
}
