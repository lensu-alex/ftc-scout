import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { findHive } from "../vision/hiveFinder";

async function frame(name: string) {
  const { data, info } = await sharp(new URL(`./fixtures/${name}`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
const near = (a: { x: number; y: number; w: number; h: number }, b: { x: number; w: number }, tol = 25) => Math.abs(a.x - b.x) <= tol && Math.abs(a.w - b.w) <= tol;

describe("findHive", () => {
  it("Oregon side camera", async () => {
    const h = findHive(await frame("oregon_side.jpg"))!;
    expect(h).not.toBeNull();
    expect(near(h.red, { x: 490, w: 144 })).toBe(true);
    expect(near(h.blue, { x: 648, w: 144 })).toBe(true);
  });
  it("Oregon scrimmage camera", async () => {
    const h = findHive(await frame("oregon_scrimmage.jpg"))!;
    expect(near(h.red, { x: 495, w: 137 })).toBe(true);
    expect(near(h.blue, { x: 659, w: 137 })).toBe(true);
  });
  it("Michigan camera looking down", async () => {
    const h = findHive(await frame("michigan_top.jpg"))!;
    expect(near(h.red, { x: 489, w: 109 })).toBe(true);
    expect(near(h.blue, { x: 614, w: 94 })).toBe(true);
  });
  it("a JPEG-softened frame like the helper gets", async () => {
    const h = findHive(await frame("oregon_q9_jpeg.jpg"))!;
    expect(near(h.red, { x: 476, w: 146 }, 30)).toBe(true);
    expect(h.blue.x).toBeGreaterThan(h.red.x + 100);
  });
});
