import type { MatchAnalysis } from "./analyzeMatch";
import type { Pick } from "./identify";
import { launchEstimate, robotStats, type LaunchEstimate, type RobotStats } from "./robotStats";

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
}

export async function toReport(
  a: MatchAnalysis, encodeThumb: (f: NonNullable<MatchAnalysis["views"][number]["thumb"]>) => Promise<string>,
  identity?: Pick, confirmed = false,
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
