// Match name types + text parsers. The app reads the overlay with the tiny template reader
// (tinyOcr.ts); Tesseract is only used by dev scripts (scripts/tesseractReader.ts) to make labels.

export type MatchLevel = "Practice" | "Qualification" | "Playoff" | "Final" | "Test" | "Other";
export interface MatchName { level: MatchLevel; number: number; raw: string }

export function parseClock(s: string): number | null {
  const m = s.replace(/\s/g, "").match(/(\d):?(\d)(\d)/);
  if (!m) return null;
  const v = +m[1] * 60 + +m[2] * 10 + +m[3];
  return v <= 150 && +m[2] < 6 ? v : null;
}

export function parseMatchName(s: string): MatchName | null {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/(Practice|Qualification|Qual|Playoff|Final|Test)\w*\s*(?:Match\s*)?(\d+)/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const level: MatchLevel = key.startsWith("qual") ? "Qualification" : key.startsWith("prac") ? "Practice"
    : key.startsWith("play") ? "Playoff" : key.startsWith("fin") ? "Final" : key.startsWith("test") ? "Test" : "Other";
  return { level, number: +m[2], raw: t };
}

