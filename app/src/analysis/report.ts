import type { MatchAnalysis } from "./analyzeMatch";
import type { Pick } from "./identify";
import { launchEstimate, robotStats, type LaunchEstimate, type RobotStats } from "./robotStats";
import type { Attribution } from "./attribution";
import { splitAlliance } from "./pieces";

/** Pollen read at the hive: per alliance, and per robot when the 1080p pass could tell who shot. */
export interface Scoring {
  hive: Record<"red" | "blue", { balls: number; volleys: number; tips: number }>;
  /** every volley: when, which hive, how many balls, which robot track (null = couldn't tell), how sure */
  volleys: { t: number; hive: "red" | "blue"; balls: number; robot: number | null; confidence: number }[];
  /** the scouted team's robot: balls from volleys attributed to its tracks */
  team: { sure: number; unsure: number; volleys: number } | null;
  /** its alliance partner (the other robot of the team's alliance) */
  partner: { sure: number; unsure: number; volleys: number } | null;
  attributed: boolean;     // false when the 1080p pass didn't run (no 1080p stream / fetch failed)
}

// Plain-JSON form of a match analysis: what the background helper sends to the page.
export interface MatchReport {
  start: number;
  cuts: number;
  views: { id: number; seconds: number; shots: number; live: boolean; thumbUrl: string | null }[];
  mainView: number | null;
  mainCoverage: number;
  clockChecks: { t: number; expected: number; read: number | null }[];
  phaseTimes: MatchAnalysis["phaseTimes"];
  framesAnalysed: number;
  robotsTracked: number;
  /** The scouted team's robot, if identified: its path on the main view (1280x720 image coords). */
  team: {
    confidence: number; needsConfirmation: boolean; path: { t: number; x: number; y: number; s: number }[]; stats: RobotStats | null;
    launches?: { t: number; x: number; y: number; strong: boolean }[];  // t = seconds into the match
    launchEstimate?: LaunchEstimate;
  } | null;
  /** When unsure: pictures of the robots it could be, so the user can point at the right one. */
  candidates?: { trackId: number; thumbUrl: string | null; picked: boolean }[];
  confirmed?: boolean;
  scoring?: Scoring;
}

/** Scoring summary from the hive events and (optionally) the per-volley attribution. */
export function scoringOf(a: MatchAnalysis, teamAlliance: "Red" | "Blue", teamSeed: number[], attribution: Attribution[] | null, alliancePieces?: number[]): Scoring {
  // every piece of the alliance belongs to the team or the partner
  const split = alliancePieces ? splitAlliance(a, alliancePieces, teamSeed) : { team: teamSeed, partner: [] as number[], unsure: [] as number[] };
  const teamTracks = split.team;
  const hive = { red: { balls: 0, volleys: 0, tips: 0 }, blue: { balls: 0, volleys: 0, tips: 0 } };
  for (const e of a.hiveEvents) { if (e.kind === "tip") hive[e.hive].tips++; else { hive[e.hive].volleys++; hive[e.hive].balls += e.balls ?? 0; } }
  const volleys = a.hiveEvents.filter(e => e.kind === "scored").map(e => {
    const at = attribution?.find(x => x.hive === e.hive && Math.abs(x.t - e.t) < 0.05);
    return { t: +e.t.toFixed(2), hive: e.hive, balls: e.balls ?? 0, robot: at?.robot ?? null, confidence: at ? +at.confidence.toFixed(2) : 0 };
  });
  const mine = teamAlliance.toLowerCase() as "red" | "blue";
  // a volley is sure for a robot when the shooter was clear AND the piece's robot is clear
  const sum = (pick: (v: (typeof volleys)[number]) => boolean) => {
    const vs = volleys.filter(v => v.hive === mine && v.robot !== null && pick(v));
    const sureV = (v: (typeof volleys)[number]) => v.confidence >= 0.6 && !split.unsure.includes(v.robot!);
    return { sure: vs.filter(sureV).reduce((n, v) => n + v.balls, 0), unsure: vs.filter(v => !sureV(v)).reduce((n, v) => n + v.balls, 0), volleys: vs.length };
  };
  const team = attribution && teamTracks.length ? sum(v => teamTracks.includes(v.robot!)) : null;
  const partner = attribution && teamTracks.length ? sum(v => split.partner.includes(v.robot!)) : null;
  return { hive, volleys, team, partner, attributed: !!attribution };
}

export async function toReport(
  a: MatchAnalysis, encodeThumb: (f: NonNullable<MatchAnalysis["views"][number]["thumb"]>) => Promise<string>,
  identity?: Pick, confirmed = false, scoring?: { alliance: "Red" | "Blue"; attribution: Attribution[] | null; alliancePieces?: number[] },
): Promise<MatchReport> {
  // the team's robot = all its track pieces, joined in time order
  const ids = identity?.trackIds ?? (identity?.trackId != null ? [identity.trackId] : []);
  const pieces = a.robots.filter(r => ids.includes(r.id));
  // the picked piece first; other pieces only fill times nobody covers yet (a robot can't be in two
  // places at once: overlapping pieces would make the path zig-zag between them)
  const ordered = [...pieces].sort((x, y) => (x.id === identity?.trackId ? -1 : y.id === identity?.trackId ? 1 : y.hits - x.hits));
  const joined: (typeof pieces)[number]["path"] = [];
  for (const r of ordered) {
    const covered = (t: number) => joined.some(q => Math.abs(q.t - t) < 0.4);
    joined.push(...r.path.filter(p => !covered(p.t)));
  }
  const robot = pieces.length ? {
    path: joined.sort((x, y) => x.t - y.t),
    launches: pieces.flatMap(r => r.launches ?? []).map(l => ({ ...l, t: +(l.t - a.start).toFixed(2), x: Math.round(l.x), y: Math.round(l.y) })).sort((x, y) => x.t - y.t),
  } : undefined;
  const ask = identity && identity.candidates && identity.candidates.length > 1;
  return {
    candidates: ask ? await Promise.all(identity.candidates!.map(async id => {
      const c = a.robots.find(r => r.id === id)?.crop;
      return { trackId: id, thumbUrl: c && c.width > 0 ? await encodeThumb(c) : null, picked: id === identity.trackId || (identity.trackIds ?? []).includes(id) };
    })) : undefined,
    confirmed,
    scoring: scoring ? scoringOf(a, scoring.alliance, ids, scoring.attribution, scoring.alliancePieces) : undefined,
    robotsTracked: a.robots.length,
    team: robot && identity ? {
      confidence: identity.confidence, needsConfirmation: identity.needsConfirmation,
      path: robot.path.map(p => ({ t: +(p.t - a.start).toFixed(2), x: Math.round(p.x), y: Math.round(p.y), s: Math.round(p.s) })),
      stats: robotStats(robot.path.map(p => ({ ...p, t: p.t - a.start }))),
      launches: robot.launches, launchEstimate: launchEstimate(robot.launches),
    } : null,
    start: a.start, cuts: Math.max(0, a.shots.length - 1), mainView: a.mainView, mainCoverage: a.mainCoverage,
    clockChecks: a.clockChecks, phaseTimes: a.phaseTimes, framesAnalysed: a.framesAnalysed,
    views: await Promise.all(a.views.map(async v => ({
      id: v.id, seconds: v.seconds, shots: v.shots, live: v.live, thumbUrl: v.thumb ? await encodeThumb(v.thumb) : null,
    }))),
  };
}

/** Browser: frame → small JPEG data URL for thumbnails. */
export async function frameToDataUrl(f: { width: number; height: number; data: Uint8ClampedArray }): Promise<string> {
  const c = new OffscreenCanvas(f.width, f.height);
  c.getContext("2d")!.putImageData(new ImageData(f.data as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
  const k = Math.min(640 / f.width, 360 / f.height), w = Math.max(1, Math.round(f.width * k)), h = Math.max(1, Math.round(f.height * k));
  const small = new OffscreenCanvas(w, h);
  small.getContext("2d")!.drawImage(c, 0, 0, w, h);
  const blob = await small.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
}
