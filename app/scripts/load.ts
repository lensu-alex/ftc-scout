// Node-only helpers for dev scripts: load images as Frames, draw debug boxes, build contact sheets.
import sharp from "sharp";
import type { Box, Frame } from "../src/vision/frame";

export async function loadFrame(path: string): Promise<Frame> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export function frameToPng(f: Frame) {
  return sharp(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.length), { raw: { width: f.width, height: f.height, channels: 4 } }).png();
}

export async function annotate(path: string, boxes: { b: Box; color: string }[], label: string, w = 480): Promise<Buffer> {
  const meta = await sharp(path).metadata();
  const s = w / meta.width!, h = Math.round(meta.height! * s);
  const rects = boxes.map(({ b, color }) => `<rect x="${b.x * s}" y="${b.y * s}" width="${b.w * s}" height="${b.h * s}" fill="none" stroke="${color}" stroke-width="2"/>`).join("");
  const esc = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg width="${w}" height="${h}">${rects}<rect x="0" y="0" width="${w}" height="20" fill="black" opacity="0.7"/><text x="4" y="15" font-size="13" fill="yellow" font-family="Arial">${esc}</text></svg>`;
  return sharp(path).resize(w, h).composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer();
}

export async function sheet(tiles: Buffer[], out: string, cols = 4, w = 480) {
  const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
  const h = Math.max(...metas.map(m => m.height!));
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: "#000" } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .jpeg({ quality: 80 }).toFile(out);
}
