import { crop, type Frame } from "./frame";
import { timerDigits, type ScoreBar } from "./overlay";
import { glyphs, match, words, GW, GH, type Glyph } from "./glyphs";
import type { MatchLevel, MatchName } from "./ocr";
import raw from "./templates.json";

// Reads the match clock and match name by matching glyphs against templates learned from
// real FTC Live overlays (scripts/build-templates.ts). No model, no download, < 1 ms per read.

const T: Record<string, Float32Array> = {};
for (const [k, b64] of Object.entries(raw as Record<string, string>)) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  T[k] = Float32Array.from(bytes, x => x / 255);
}
const clockDigits = Object.keys(T).filter(k => /^c\d$/.test(k));
const bannerDigits = Object.keys(T).filter(k => /^b\d$/.test(k));

function best(g: Glyph, keys: string[]): { ch: string; score: number } {
  let ch = "?", score = -1;
  for (const k of keys) {
    const s = match(g.bmp, T[k]);
    if (s > score) { score = s; ch = k.slice(1); }
  }
  return { ch, score };
}

const MIN_SCORE = 0.8;

export interface OverlayTextReader {
  init(): Promise<void>;
  close(): Promise<void>;
  readClock(f: Frame, bar: ScoreBar): Promise<number | null>;
  readMatchName(f: Frame, bar: ScoreBar): Promise<MatchName | null>;
}

export class TinyOverlayReader implements OverlayTextReader {
  async init() {}
  async close() {}

  async readClock(f: Frame, bar: ScoreBar): Promise<number | null> {
    const gs = glyphs(crop(f, timerDigits(bar.timer)), true, 0.45, false)
      .filter(g => (g.x1 - g.x0 + 1) / (g.y1 - g.y0 + 1) > 0.3); // drop the colon
    if (gs.length !== 3) return null;
    const d = gs.map(g => best(g, clockDigits));
    if (d.some(x => x.score < MIN_SCORE)) return null;
    const v = +d[0].ch * 60 + +d[1].ch * 10 + +d[2].ch;
    return +d[1].ch < 6 && v <= 150 ? v : null;
  }

  async readMatchName(f: Frame, bar: ScoreBar): Promise<MatchName | null> {
    const ws = words(glyphs(crop(f, bar.matchName), false, 0.3));
    if (ws.length < 2) return null;
    // the match number: the first run of digit-only words ("11" can look like two words: 1s are narrow)
    let digits = "";
    for (const w of ws.slice(1)) {
      const d = w.map(g => best(g, bannerDigits));
      if (d.every(x => x.score >= MIN_SCORE)) digits += d.map(x => x.ch).join("");
      else if (digits) break;
    }
    if (!digits) return null;
    const number = +digits;
    const level = levelOf(ws[0]);
    return level ? { level, number, raw: `${level} ${number}` } : null;
  }
}

/** Level from the first word: its first letter (Q/P/F/T), and the second letter for P (Practice vs Playoff). */
function levelOf(w: Glyph[]): MatchLevel | null {
  const first = best(w[0], ["bQ", "bP", "bF", "bT"].filter(k => T[k]));
  if (first.score < MIN_SCORE - 0.05) return null;
  if (first.ch === "Q") return "Qualification";
  if (first.ch === "F") return "Final";
  if (first.ch === "T") return "Test";
  if (w.length > 1) {
    const second = best(w[1], ["br", "bl"].filter(k => T[k]));
    return second.ch === "r" ? "Practice" : "Playoff";
  }
  return "Playoff";
}

export const GLYPH_SIZE = [GW, GH];
