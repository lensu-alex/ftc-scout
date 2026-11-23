import type { Frame } from "../vision/frame";

/**
 * Anything we can seek in and grab frames from: a local file, a YouTube embed captured
 * from the tab, or (in dev scripts) a stream URL decoded with ffmpeg.
 */
export interface VideoSource {
  readonly kind: "file" | "youtube" | "node";
  duration(): number;
  /** Seek and resolve once a frame from (about) time t is available to grab(). */
  seek(t: number): Promise<void>;
  /** The current frame, scaled to 1280x720 (the size every vision module is tuned on). */
  grab(): Promise<Frame | null>;
  currentTime(): number;
  /** Play from the current position; frames are then sampled with grab() while playing. */
  play(rate: number): Promise<void>;
  pause(): void;
  dispose(): void;
}

export const WORK_W = 1280;
export const WORK_H = 720;

/** Draw any image source letterboxed into a 1280x720 work frame. */
export function drawToFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
): Frame {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WORK_W, WORK_H);
  const s = Math.min(WORK_W / sw, WORK_H / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(img, sx, sy, sw, sh, (WORK_W - dw) / 2, (WORK_H - dh) / 2, dw, dh);
  const d = ctx.getImageData(0, 0, WORK_W, WORK_H);
  return { width: d.width, height: d.height, data: d.data };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
