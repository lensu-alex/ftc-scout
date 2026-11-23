import type { Frame } from "../vision/frame";
import { drawToFrame, sleep, WORK_H, WORK_W, type VideoSource } from "./source";

// Link mode: the YouTube video plays in an embed on our page, the browser shares this tab
// with us (one permission prompt), and frames are read from that capture. Nothing is
// downloaded or stored; only the parts we seek to are streamed.
//
// Desktop browsers only (phones can't capture the screen). Chrome/Edge can share just this tab;
// Safari and Firefox share a window or the whole screen. Either way we find the player inside the
// captured image by briefly flashing a marker over it (calibrate), so any of these works.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void; CropTarget?: any }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiReady ??= new Promise(res => {
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiReady;
}

export function tabCaptureSupported() {
  return !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent);
}

export class YouTubeSource implements VideoSource {
  readonly kind = "youtube" as const;
  private player: any;
  private host: HTMLElement;
  private stream: MediaStream | null = null;
  private capture = document.createElement("video");
  private cropped = false;
  private region: { x: number; y: number; w: number; h: number } | null = null; // player inside the capture
  private dirty = true;
  private calRect: DOMRect | null = null; // where the player was on the page when calibrated
  private onMove = () => { this.dirty = true; };
  private ctx = new OffscreenCanvas(WORK_W, WORK_H).getContext("2d", { willReadFrequently: true })!;

  private constructor(host: HTMLElement, player: any) {
    this.host = host;
    this.player = player;
    window.addEventListener("resize", this.onMove);

  }

  /** `host` is the element the player is mounted in; it must stay visible while analysing. */
  static async open(host: HTMLElement, videoId: string): Promise<YouTubeSource> {
    await loadApi();
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    const player = await new Promise<any>((res, rej) => {
      const p = new window.YT.Player(mount, {
        videoId, width: "100%", height: "100%",
        playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, mute: 1, modestbranding: 1 },
        events: {
          onReady: () => res(p),
          onError: (e: any) => rej(new Error(e.data === 101 || e.data === 150
            ? "The owner of this video doesn't allow it to be played on other sites. Use file mode instead."
            : `YouTube player error ${e.data}`)),
        },
      });
    });
    // a transparent cover stops hover from bringing up YouTube's title bar on top of the video
    const cover = document.createElement("div");
    cover.style.cssText = "position:absolute;inset:0;z-index:2";
    host.style.position = "relative";
    host.appendChild(cover);
    return new YouTubeSource(host, player);
  }

  /** Ask to share this tab. Call it first thing in a click handler: browsers require a fresh user gesture. */
  static requestTab(): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 30 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
  }

  /** Read frames from a tab capture (see requestTab), cropped to the player when the browser allows. */
  async attach(stream: MediaStream) {
    this.stream = stream;
    const track = this.stream.getVideoTracks()[0];
    // Region Capture (Chrome): crop the captured tab down to just the player.
    if (window.CropTarget && "cropTo" in track) {
      try {
        const target = await window.CropTarget.fromElement(this.host);
        await (track as any).cropTo(target);
        this.cropped = true;
      } catch { this.cropped = false; }
    }
    this.capture.muted = true;
    this.capture.playsInline = true;
    this.capture.srcObject = this.stream;
    await this.capture.play();
    track.addEventListener("ended", () => { this.stream = null; });
    if (!this.cropped) await this.calibrate();
  }

  /**
   * Find the player inside the captured image: cover it with a solid magenta box for a moment
   * and look for that box. Works for tab, window and full-screen sharing, any zoom or screen scale.
   */
  async calibrate() {
    if (this.cropped) { this.dirty = false; return; }
    this.host.scrollIntoView({ block: "center" });
    const marker = document.createElement("div");
    marker.style.cssText = "position:absolute;inset:0;z-index:5;background:#ff00ff";
    this.host.appendChild(marker);
    try {
      let found: typeof this.region = null;
      for (let attempt = 0; attempt < 8 && !found; attempt++) {
        await sleep(250);
        found = this.findMarker();
      }
      if (!found) throw new Error("Couldn't see the video player in what you shared. Share this tab or this browser window, and keep the player visible on screen.");
      this.region = found;
      this.calRect = this.host.getBoundingClientRect();
      this.dirty = false;
    } finally {
      marker.remove();
      await sleep(200);
    }
  }

  private findMarker() {
    const v = this.capture;
    const W = v.videoWidth, H = v.videoHeight;
    if (!W || !H) return null;
    const c = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
    c.drawImage(v, 0, 0);
    const d = c.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const p = (y * W + x) * 4;
      if (d[p] > 200 && d[p + 1] < 70 && d[p + 2] > 200) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const w = x1 - x0 + 2, h = y1 - y0 + 2;
    // must be a solid, roughly 16:9 block of a decent size
    if (n < 2000 || w < 160 || Math.abs(w / h - 16 / 9) > 0.25 || n < (w * h) / 4 * 0.8) return null;
    return { x: x0, y: y0, w, h };
  }

  get capturing() { return !!this.stream?.active; }

  /** Switch to another video in the same player (the tab capture keeps running). */
  async load(videoId: string) {
    this.player.cueVideoById(videoId);
    const t0 = performance.now();
    while (!(this.player.getDuration() > 0) && performance.now() - t0 < 15000) await sleep(200);
  }

  duration() { return this.player.getDuration(); }
  currentTime() { return this.player.getCurrentTime(); }

  /** Re-find the player if the page moved it (scroll, resize, content above it changed size). */
  private async ensureCalibrated() {
    if (!this.stream || this.cropped) return;
    const r = this.host.getBoundingClientRect(), c = this.calRect;
    const moved = !c || Math.abs(r.left - c.left) > 2 || Math.abs(r.top - c.top) > 2 || Math.abs(r.width - c.width) > 2;
    if (this.dirty || moved) await this.calibrate();
  }

  async seek(t: number) {
    await this.ensureCalibrated();
    this.player.seekTo(t, true);
    this.player.playVideo();
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) {
      await sleep(150);
      const now = this.player.getCurrentTime();
      if (this.player.getPlayerState() === 1 && now >= t - 0.5 && now < t + 4) break;
    }
    // give the capture pipeline a moment to deliver frames from the new position
    await sleep(500);
  }

  async grab(): Promise<Frame | null> {
    const v = this.capture;
    if (!v.videoWidth) return null;
    if (!this.stream) throw new Error("Screen sharing stopped. Press Start again and share this tab or window.");
    if (this.cropped) return drawToFrame(this.ctx, v, 0, 0, v.videoWidth, v.videoHeight);
    if (!this.region) return null;
    const r = this.region;
    const f = drawToFrame(this.ctx, v, r.x, r.y, r.w, r.h);
    if (import.meta.env.DEV || (window as any).__ftcDebugOn) (window as any).__ftcDebug = { frame: f, region: r, capture: [v.videoWidth, v.videoHeight], at: this.player.getCurrentTime() };
    return f;
  }

  async play(rate: number) {
    await this.ensureCalibrated();
    this.player.setPlaybackRate(rate);
    this.player.playVideo();
  }

  pause() { this.player.pauseVideo(); }

  dispose() {
    window.removeEventListener("resize", this.onMove);

    this.stream?.getTracks().forEach(t => t.stop());
    this.player.destroy?.();
  }
}
