import type { Frame } from "../vision/frame";
import { drawToFrame, WORK_H, WORK_W, type VideoSource } from "./source";

/** A local video file. Works on any device, nothing is uploaded or copied. */
export class FileSource implements VideoSource {
  readonly kind = "file" as const;
  private video: HTMLVideoElement;
  private url: string;
  private ctx = new OffscreenCanvas(WORK_W, WORK_H).getContext("2d", { willReadFrequently: true })!;

  private constructor(video: HTMLVideoElement, url: string) {
    this.video = video;
    this.url = url;
  }

  static async open(file: File): Promise<FileSource> {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("this browser can't play that video file"));
    });
    return new FileSource(v, url);
  }

  duration() { return this.video.duration; }
  currentTime() { return this.video.currentTime; }

  async seek(t: number) {
    const v = this.video;
    await new Promise<void>(res => {
      v.onseeked = () => res();
      v.currentTime = Math.max(0, Math.min(t, v.duration - 0.1));
    });
  }

  async grab(): Promise<Frame | null> {
    const v = this.video;
    if (!v.videoWidth) return null;
    return drawToFrame(this.ctx, v, 0, 0, v.videoWidth, v.videoHeight);
  }

  async play(rate: number) {
    this.video.playbackRate = rate;
    await this.video.play();
  }

  pause() { this.video.pause(); }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    URL.revokeObjectURL(this.url);
  }
}
