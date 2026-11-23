import { findScoreBar } from "../vision/overlay";
import { fingerprint } from "../vision/shots";
import { MATCH_S } from "../vision/matchClock";
import type { Frame } from "../vision/frame";
import { WORK_H, WORK_W } from "../video/source";

// Time + data estimate shown before a run. Compute cost comes from a quick benchmark on this
// device; in link mode playback speed is usually the limit, so that's modelled separately.

export interface Benchmark { frameMs: number }

export async function benchmark(): Promise<Benchmark> {
  const f: Frame = { width: WORK_W, height: WORK_H, data: new Uint8ClampedArray(WORK_W * WORK_H * 4) };
  for (let i = 0; i < f.data.length; i += 4) {
    const v = (i * 2654435761) >>> 24;
    f.data[i] = v; f.data[i + 1] = (v * 7) & 255; f.data[i + 2] = (v * 13) & 255; f.data[i + 3] = 255;
  }
  findScoreBar(f); // warm up
  const n = 8, t0 = performance.now();
  for (let i = 0; i < n; i++) { findScoreBar(f); fingerprint(f); }
  return { frameMs: (performance.now() - t0) / n };
}

export interface Estimate { seconds: number; megabytes: number; perMatch: number; limitedBy: "playback" | "device" }

export const PLAY_RATE = 2;      // analysis playback speed (link + file mode)
export const SAMPLE_EVERY = 0.33; // seconds of stream time between analysed frames
const SEEK_S = 2.5;               // a YouTube seek + buffering
const OCR_MS = 120;
const MBPS_720P = 2.5;

export function estimate(b: Benchmark, matches: number, mode: "youtube" | "file" | "helper"): Estimate {
  if (matches === 0) return { seconds: 0, megabytes: 0, perMatch: 0, limitedBy: "playback" };
  const seeksFirst = 6, seeksNext = 1.5;          // measured on 9 test streams
  const seeks = seeksFirst + seeksNext * (matches - 1);
  // helper: ffmpeg seeks over the network (~1.5 s), and decoding isn't tied to playback speed
  const seekCost = (mode === "youtube" ? SEEK_S : mode === "helper" ? 1.5 : 0.3) + OCR_MS / 1000 * 2;
  const span = MATCH_S + 6;                       // a little before/after each match
  const playback = mode === "helper" ? span / 7 : span / PLAY_RATE; // helper: 8 parallel fetches, measured ~7x real time
  const frames = span / SAMPLE_EVERY;
  const compute = (frames * b.frameMs + (span / 3) * OCR_MS) / 1000;
  const perMatchAnalysis = Math.max(playback, compute);
  const seconds = seeks * seekCost + matches * perMatchAnalysis;
  const streamed = mode === "file" ? 0 : matches * span + seeks * 4;
  return {
    seconds, megabytes: (streamed * MBPS_720P) / 8, perMatch: seconds / matches,
    limitedBy: compute > playback ? "device" : "playback",
  };
}

export function fmtDuration(s: number) {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
