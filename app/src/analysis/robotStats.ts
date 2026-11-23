import { AUTO_S, MATCH_S, TRANSITION_S } from "../vision/matchClock";
import { FIELD_FT, toField, type Homography } from "../vision/field";

// Movement statistics from a robot's path on the camera image. The robot's own on-screen size
// is the ruler (an FTC robot is at most 18 in), so the numbers work on any camera angle before
// the field is mapped. They are approximate; field mapping will make them exact.

export const ROBOT_FT = 1.5; // 18 in

export interface PathPoint { t: number; x: number; y: number; s: number } // t = seconds into the match

export interface RobotStats {
  trackedPct: number;     // share of the match the robot was followed
  distanceFt: number;     // whole match
  autoDistanceFt: number;
  topSpeedFtS: number;
  avgSpeedFtS: number;    // while moving
  movingPct: number;      // share of tracked time it was moving
}

/**
 * Launches → an estimate with a range. Hand-checked on two low-camera Oregon matches (38 launches):
 * about 55% of detected launches are real, and some real ones are missed (faint, hidden). So the
 * estimate is about the detected count, between half of it and 1.5x.
 */
export const LAUNCH_PRECISION = { est: 0.9, low: 0.5, high: 1.5 };
export interface LaunchEstimate { detected: number; est: number; low: number; high: number; auto: number }
export function launchEstimate(launches: { t: number; strong: boolean }[]): LaunchEstimate {
  const s = launches.filter(l => l.strong);
  const k = LAUNCH_PRECISION;
  return {
    detected: s.length, est: Math.round(s.length * k.est), low: Math.floor(s.length * k.low), high: Math.ceil(s.length * k.high),
    auto: Math.round(s.filter(l => l.t < AUTO_S).length * k.est),
  };
}

export function robotStats(path: PathPoint[]): RobotStats | null {
  const p = path.filter(q => q.t >= 0 && q.t <= MATCH_S).sort((a, b) => a.t - b.t);
  if (p.length < 4) return null;
  let dist = 0, autoDist = 0, moving = 0, tracked = 0, top = 0;
  const speeds: number[] = [];
  for (let i = 1; i < p.length; i++) {
    const dt = p[i].t - p[i - 1].t;
    if (dt <= 0 || dt > 2) continue; // gaps (robot hidden) don't count as driving
    const size = (p[i].s + p[i - 1].s) / 2 || 1;
    const ft = (Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) / size) * ROBOT_FT;
    const v = ft / dt;
    if (v > 12) continue; // faster than any FTC robot: a tracking jump, not driving
    tracked += dt;
    if (p[i].t >= AUTO_S && p[i].t < AUTO_S + TRANSITION_S) continue; // robots stand still in the transition
    speeds.push(v);
    if (v > 0.5) { dist += ft; moving += dt; if (p[i].t < AUTO_S) autoDist += ft; }
  }
  if (!speeds.length) return null;
  const sorted = [...speeds].sort((a, b) => a - b);
  top = sorted[Math.floor(sorted.length * 0.95)]; // 95th percentile: ignores single-frame spikes
  const movingSpeeds = speeds.filter(v => v > 0.5);
  return {
    trackedPct: Math.min(1, tracked / (MATCH_S - TRANSITION_S)),
    distanceFt: dist, autoDistanceFt: autoDist, topSpeedFtS: top,
    avgSpeedFtS: movingSpeeds.length ? movingSpeeds.reduce((a, b) => a + b, 0) / movingSpeeds.length : 0,
    movingPct: tracked ? moving / tracked : 0,
  };
}

/** Robust "unusual match" check: how far a value is from the team's median, in median deviations. */
export function outlierScore(values: number[], v: number): number {
  const s = [...values].sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const mad = [...s.map(x => Math.abs(x - med))].sort((a, b) => a - b)[s.length >> 1] || 1e-6;
  return (v - med) / (1.4826 * mad);
}

/**
 * A path on the camera image → the same path on the field floor in feet (see vision/field.ts).
 * Points well outside the field are tracking errors and are dropped. With s = ROBOT_FT,
 * robotStats() then measures true feet instead of robot lengths.
 */
export function pathOnField(path: PathPoint[], h: Homography): PathPoint[] {
  return path.flatMap(p => {
    const f = toField(h, p);
    return f.x > -1 && f.x < FIELD_FT + 1 && f.y > -1 && f.y < FIELD_FT + 1 ? [{ t: p.t, x: f.x, y: f.y, s: ROBOT_FT }] : [];
  });
}

/**
 * The auto part of a path as separate lines: a gap (robot lost for a moment, or a jump to a
 * different spot) starts a new line instead of being drawn as a straight drive. `jump` is in the
 * path's own units (robot lengths on the image are taken from p.s when it is set).
 */
export function autoSegments(path: PathPoint[], jumpFt = 4): PathPoint[][] {
  const out: PathPoint[][] = [];
  for (const p of path.filter(q => q.t >= 0 && q.t < AUTO_S)) {
    const seg = out[out.length - 1], q = seg?.[seg.length - 1];
    const far = q && Math.hypot(p.x - q.x, p.y - q.y) > (p.s === ROBOT_FT ? jumpFt : 2.5 * Math.max(p.s, q.s));
    if (!q || p.t - q.t > 1.5 || far) out.push([p]); else seg.push(p);
  }
  return out.filter(s => s.length > 1);
}

/**
 * Possible disconnects: stretches in teleop where the robot was in view the whole time but didn't
 * move (stayed within half a robot length) for 15 s or more. Not counted: the transition, the last
 * 30 s (parking), and stops where it launched balls (standing still to shoot is normal).
 */
export interface Stop { from: number; to: number } // seconds into the match
const STOP_S = 15, PARK_FROM = MATCH_S - 30;
export function stops(path: PathPoint[], launches: { t: number; strong: boolean }[] = []): Stop[] {
  const p = path.filter(q => q.t >= AUTO_S + TRANSITION_S && q.t <= PARK_FROM).sort((a, b) => a.t - b.t);
  const out: Stop[] = [];
  let i = 0;
  while (i < p.length) {
    let j = i;
    // grow while it stays near where the stretch began and the robot stays in view
    while (j + 1 < p.length && p[j + 1].t - p[j].t <= 2.5 && Math.hypot(p[j + 1].x - p[i].x, p[j + 1].y - p[i].y) <= 0.5 * (p[i].s || ROBOT_FT)) j++;
    const from = p[i].t, to = p[j].t;
    if (to - from >= STOP_S && !launches.some(l => l.strong && l.t >= from && l.t <= to)) out.push({ from, to });
    i = j > i ? j + 1 : i + 1;
  }
  return out;
}

// ---- scouting stats from the path alone (units: the robot's own length, p.s, so image or field paths both work) ----

const unit = (p: PathPoint) => p.s || ROBOT_FT;
const near = (a: PathPoint, b: PathPoint, k: number) => Math.hypot(a.x - b.x, a.y - b.y) <= k * Math.max(unit(a), unit(b));

/** LEAVE in auto: it got more than one robot length away from where it started. null = not seen in auto. */
export function leftStart(path: PathPoint[]): boolean | null {
  const a = path.filter(p => p.t >= 0 && p.t < AUTO_S);
  // a "no" needs most of auto actually seen; a "yes" only needs the move
  if (a.length < 3) return null;
  if (a.some(p => !near(p, a[0], 1))) return true;
  return a[a.length - 1].t - a[0].t >= 15 && a[0].t <= 5 ? false : null;
}

export interface Dwell { x: number; y: number; s: number; from: number; to: number }
/** Places it stopped (≥ 1.5 s within half a robot length) during teleop: where it collects or shoots. */
export function dwells(path: PathPoint[]): Dwell[] {
  const p = path.filter(q => q.t >= AUTO_S + TRANSITION_S).sort((a, b) => a.t - b.t);
  const out: Dwell[] = [];
  let i = 0;
  while (i < p.length) {
    let j = i;
    while (j + 1 < p.length && p[j + 1].t - p[j].t <= 1.5 && near(p[j + 1], p[i], 0.5)) j++;
    if (p[j].t - p[i].t >= 1.5) {
      const seg = p.slice(i, j + 1);
      out.push({ x: seg.reduce((a, q) => a + q.x, 0) / seg.length, y: seg.reduce((a, q) => a + q.y, 0) / seg.length, s: unit(p[i]), from: p[i].t, to: p[j].t });
    }
    i = j + 1;
  }
  return out;
}

/**
 * Cycles: the robot keeps coming back to the same spot (where it scores) after driving away to get more
 * balls. The spot = where it stopped most often; a cycle = a return to it after being 2+ robot lengths away.
 */
export function cycles(path: PathPoint[]): { count: number; spot: Dwell | null } {
  const ds = dwells(path);
  if (!ds.length) return { count: 0, spot: null };
  const close = (a: Dwell, b: Dwell) => Math.hypot(a.x - b.x, a.y - b.y) <= 1.2 * Math.max(a.s, b.s);
  const spot = ds.reduce((best, d) => (ds.filter(e => close(e, d)).length > ds.filter(e => close(e, best)).length ? d : best));
  const visits = ds.filter(d => close(d, spot)).sort((a, b) => a.from - b.from);
  let count = 0, last: Dwell | null = null;
  for (const v of visits) {
    // between two visits it must have driven away (more than 2 robot lengths)
    const away = !last || path.some(p => p.t > last!.to && p.t < v.from && Math.hypot(p.x - spot.x, p.y - spot.y) > 2 * spot.s);
    if (away) count++;
    last = v;
  }
  return { count, spot };
}

/** End of the match: where it was, and whether it sat still for the last 10 s (parked). null = not seen. */
export function endgame(path: PathPoint[]): { parked: boolean; at: PathPoint } | null {
  const e = path.filter(p => p.t >= MATCH_S - 10 && p.t <= MATCH_S);
  if (e.length < 3 || e[e.length - 1].t - e[0].t < 5) return null;
  return { parked: e.every(p => near(p, e[e.length - 1], 0.5)), at: e[e.length - 1] };
}

/**
 * How alike two auto paths are, by shape (a route driven a bit faster or slower is the same route): the
 * average distance from each point of one path to the nearest point of the other, both ways, in robot
 * lengths, plus how far apart they started. Below ~1.5 = the same routine.
 */
export function autoDistance(a: PathPoint[], b: PathPoint[]): number | null {
  const A = a.filter(p => p.t >= 0 && p.t < AUTO_S), B = b.filter(p => p.t >= 0 && p.t < AUTO_S);
  if (A.length < 5 || B.length < 5) return null;
  const to = (p: PathPoint, Q: PathPoint[]) => Math.min(...Q.map(q => Math.hypot(p.x - q.x, p.y - q.y) / Math.max(unit(p), unit(q))));
  const ab = A.reduce((s, p) => s + to(p, B), 0) / A.length, ba = B.reduce((s, p) => s + to(p, A), 0) / B.length;
  return Math.max((ab + ba) / 2, Math.hypot(A[0].x - B[0].x, A[0].y - B[0].y) / Math.max(unit(A[0]), unit(B[0])) / 2);
}
