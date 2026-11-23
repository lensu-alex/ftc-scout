// Decoding with ffmpeg: one frame at a time (seeks) or a run of frames (a match).
import { spawn } from "node:child_process";
import type { Frame } from "../src/vision/frame";
import { ffmpegPath } from "./bins";

const W = 1280, H = 720;
const EOI = Buffer.from([0xff, 0xd9]);

export function grabAt(src: string, t: number, timeoutMs = 30000): Promise<Frame | null> {
  return new Promise(res => {
    const p = spawn(ffmpegPath(), ["-loglevel", "error", "-ss", String(t), "-i", src, "-frames:v", "1",
      "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    const chunks: Buffer[] = [];
    // a seek can hang on a stalled connection: give up and let the caller try elsewhere
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", c => chunks.push(c));
    p.on("close", () => {
      clearTimeout(timer);
      const b = Buffer.concat(chunks);
      res(b.length === W * H * 4 ? { width: W, height: H, data: new Uint8ClampedArray(b) } : null);
    });
    p.on("error", () => res(null));
  });
}

export async function* readFrames(src: string, fps: number, start = 0, dur?: number, size: { w: number; h: number } = { w: W, h: H }): AsyncGenerator<{ t: number; frame: Frame }> {
  const args = ["-loglevel", "error", "-ss", String(start), "-i", src, ...(dur ? ["-t", String(dur)] : []),
    "-vf", `fps=${fps},scale=${size.w}:${size.h}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
  const p = spawn(ffmpegPath(), args);
  const { w: FW, h: FH } = size;
  const size_ = FW * FH * 4;
  let buf = Buffer.alloc(0), i = 0;
  try {
    for await (const chunk of p.stdout) {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size_) {
        const data = new Uint8ClampedArray(buf.subarray(0, size_));
        buf = buf.subarray(size_);
        yield { t: start + i++ / fps, frame: { width: FW, height: FH, data } };
      }
    }
  } finally {
    p.kill();
  }
}

/**
 * Same frames as readFrames, but fetched as `parts` time ranges in parallel: YouTube limits the
 * speed of each connection, so one match arrives ~5x faster this way. Each part decodes its own
 * exact range and hands over JPEG frames (small, in memory), which are yielded in time order.
 */
export async function* readFramesParallel(src: string, fps: number, start: number, dur: number, parts = 8): AsyncGenerator<{ t: number; frame: Frame }> {
  const len = dur / parts;
  const expected = Math.round(len * fps);
  const chunks = Array.from({ length: parts }, (_, i) => {
    const s = start + i * len;
    const c = { s, frames: [] as Buffer[], done: false, wake: null as null | (() => void), p: null as null | ReturnType<typeof spawn> };
    // a part that stops early (stalled or dropped connection) resumes from its last frame, twice at most
    let tries = 0;
    const run = () => {
      const from = c.frames.length / fps;
      const p = spawn(ffmpegPath(), ["-loglevel", "error", "-ss", String(s + from), "-i", src, "-t", String(len - from),
        "-vf", `fps=${fps},scale=${W}:${H}`, "-c:v", "mjpeg", "-q:v", "3", "-f", "image2pipe", "-"]);
      c.p = p;
      let pending: Buffer[] = [], scanned = 0;
      p.stdout.on("data", (d: Buffer) => {
        // split the stream on JPEG end-of-image markers (FF D9 never occurs inside JPEG data)
        pending.push(d);
        let buf = pending.length > 1 ? Buffer.concat(pending) : d;
        let from = Math.max(0, scanned - 1), end: number;
        while ((end = buf.indexOf(EOI, from)) >= 0) {
          if (c.frames.length < expected) c.frames.push(Buffer.from(buf.subarray(0, end + 2)));
          buf = buf.subarray(end + 2);
          from = 0;
        }
        pending = buf.length ? [buf] : [];
        scanned = buf.length;
        c.wake?.();
      });
      // a stalled part ends instead of hanging; a slow one (busy computer) keeps going as long as data arrives
      let timer = setTimeout(() => p.kill("SIGKILL"), 45000);
      p.stdout.on("data", () => { clearTimeout(timer); timer = setTimeout(() => p.kill("SIGKILL"), 45000); });
      let ended = false;
      const end = () => {
        if (ended) return; // "error" and "close" can both fire
        ended = true;
        clearTimeout(timer);
        if (c.frames.length < expected - 2 && tries < 2 && !c.done) { tries++; run(); return; }
        c.done = true; c.wake?.();
      };
      p.on("close", end);
      p.on("error", end);
    };
    run();
    return { c };
  });
  const { default: sharp } = await import("sharp");
  try {
    for (const { c } of chunks) {
      let k = 0;
      for (;;) {
        if (k < c.frames.length) {
          const jpg = c.frames[k]; c.frames[k] = Buffer.alloc(0); // free as we go
          const { data } = await sharp(jpg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          yield { t: c.s + k / fps, frame: { width: W, height: H, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) } };
          k++;
        } else if (c.done) break;
        else await new Promise<void>(r => { c.wake = r; });
      }
    }
  } finally {
    for (const { c } of chunks) { c.done = true; c.p?.kill(); }
  }
}
