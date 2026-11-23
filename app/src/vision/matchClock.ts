// FTC Live match clock (verified on BIOBUZZ streams):
//   pre-start shows 2:30 · AUTO counts 2:30 → 2:01 · transition shows 0:08 → 0:01 · TELEOP 2:00 → 0:00
// A single reading tells us how far into the match we are; a few readings pin the start time.

export const AUTO_S = 30;
export const TRANSITION_S = 8;
export const TELEOP_S = 120;
export const MATCH_S = AUTO_S + TRANSITION_S + TELEOP_S; // 158

export type Phase = "pre" | "auto" | "transition" | "teleop" | "post";

export interface ClockReading {
  t: number;        // stream time (s)
  clock: number;    // seconds shown on the clock
}

/**
 * Elapsed match seconds for a clock value. Clock 1–8 is ambiguous (transition or the last
 * seconds of teleop); `hint` (an elapsed guess) picks the closer interpretation.
 */
export function elapsedFor(clock: number, hint?: number): number {
  if (clock > TELEOP_S) return 150 - clock;
  const teleop = AUTO_S + TRANSITION_S + (TELEOP_S - clock);
  if (clock <= TRANSITION_S && clock > 0) {
    const transition = AUTO_S + (TRANSITION_S - clock);
    if (hint !== undefined && Math.abs(hint - transition) < Math.abs(hint - teleop)) return transition;
  }
  return teleop;
}

export function phaseAt(elapsed: number): Phase {
  if (elapsed < 0) return "pre";
  if (elapsed < AUTO_S) return "auto";
  if (elapsed < AUTO_S + TRANSITION_S) return "transition";
  if (elapsed < MATCH_S) return "teleop";
  return "post";
}

/**
 * Robustly estimate the stream time the match started at from several clock readings.
 * Readings of 2:30 (not started yet) and 0:00 (finished) don't fix the start and are skipped.
 * Returns null when there is nothing usable.
 */
export function fitStart(readings: ClockReading[], hintStart?: number): number | null {
  const est: number[] = [];
  for (const r of readings) {
    if (r.clock >= 150 || r.clock <= 0) continue;
    const hint = hintStart !== undefined ? r.t - hintStart : undefined;
    est.push(r.t - elapsedFor(r.clock, hint));
  }
  if (!est.length) return null;
  est.sort((a, b) => a - b);
  // the median ignores single OCR misreads
  const med = est[est.length >> 1];
  const close = est.filter(e => Math.abs(e - med) <= 2);
  return close.reduce((a, b) => a + b, 0) / close.length;
}
