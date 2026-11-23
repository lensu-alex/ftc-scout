// dev: balls that appear somewhere for a single frame (not on the floor) = probably in flight
import { readFrames } from "../helper/ffmpeg";
import { nodeInfer } from "../helper/detector";
import { detect } from "../src/vision/detector";
import { findScoreBar } from "../src/vision/overlay";
import { frameToPng } from "./load";
import type { Frame } from "../src/vision/frame";
const [clip, s, fpsArg = "6"] = process.argv.slice(2);
const fps = +fpsArg;
const seq: { t: number; balls: { x: number; y: number; r: number; c: string }[] }[] = [];
let mid: Frame | null = null;
for await (const { t, frame } of readFrames(clip, fps, +s, 158)) {
  if (!mid && t > +s + 60) mid = frame;
  const bar = findScoreBar(frame);
  const roi = bar ? { x: 0, y: 0, w: frame.width, h: bar.banner.y } : undefined;
  const d = await detect(frame, nodeInfer, { size: 640, roi, minScore: {} });
  seq.push({ t, balls: d.filter(x => x.cls !== "robot").map(x => ({ x: x.x + x.w / 2, y: x.y + x.h / 2, r: Math.max(x.w, x.h), c: x.cls })) });
}
const near = (a: any, list: any[], k = 1) => list.some(b => Math.hypot(a.x - b.x, a.y - b.y) < k * Math.max(a.r, b.r));
// moving balls: no ball at the same spot in the frame before
const mov = seq.map((f, i) => i === 0 ? [] : f.balls.filter(b => !near(b, seq[i - 1].balls)));
// chains of moving balls in consecutive frames, 1-10 ball sizes apart
type P = { t: number; x: number; y: number; r: number };
const chains: P[][] = [];
let open: P[][] = [];
mov.forEach((bs, i) => {
  const next: P[][] = [], used = new Set<number>();
  for (const ch of open) {
    const l = ch[ch.length - 1];
    let bi = -1, bd = Infinity;
    bs.forEach((b, k) => { const d = Math.hypot(b.x - l.x, b.y - l.y); if (!used.has(k) && d > l.r && d < 10 * l.r && d < bd) { bd = d; bi = k; } });
    if (bi >= 0) { used.add(bi); next.push([...ch, { t: seq[i].t - +s, ...bs[bi] }]); } else chains.push(ch);
  }
  bs.forEach((b, k) => { if (!used.has(k)) next.push([{ t: seq[i].t - +s, ...b }]); });
  open = next;
});
chains.push(...open);
const shots = chains.filter(c => c.length >= 3 && c[c.length - 1].y - c[0].y < -2 * c[0].r);
console.log(`frames ${seq.length}, chains>=3: ${chains.filter(c => c.length >= 3).length}, rising: ${shots.length}`);
console.log(shots.map(c => `${c[0].t.toFixed(1)}s(${c.length})`).join(" "));
const svg = `<svg width="1280" height="720">${shots.map(c => `<polyline points="${c.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${c[0].t < 30 ? "#fff" : "#f0f"}" stroke-width="3"/><circle cx="${c[0].x}" cy="${c[0].y}" r="6" fill="#0f0"/>`).join("")}</svg>`;
await frameToPng(mid!).composite([{ input: Buffer.from(svg) }]).jpeg().toFile("../tools/debug/flight.jpg");
