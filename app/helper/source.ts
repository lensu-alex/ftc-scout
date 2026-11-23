// VideoSource backed by ffmpeg seeks on a URL or local file: no player, no window.
import type { Frame } from "../src/vision/frame";
import type { VideoSource } from "../src/video/source";
import { grabAt, readFramesParallel } from "./ffmpeg";

export class NodeSource implements VideoSource {
  readonly kind = "node" as const;
  private t = 0;
  private frame: Frame | null = null;
  private url: string;
  private dur: number;
  constructor(url: string, duration: number) { this.url = url; this.dur = duration; }
  duration() { return this.dur; }
  currentTime() { return this.t; }
  async seek(t: number) {
    this.t = t;
    this.frame = await grabAt(this.url, t);
  }
  async grab() { return this.frame; }
  async play() { throw new Error("use frames() with NodeSource"); }
  pause() {}
  dispose() {}
  frames(from: number, dur: number, fps: number) { return readFramesParallel(this.url, fps, from, dur); }
}
