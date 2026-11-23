import { crop, type Frame } from "../vision/frame";
import { findScoreBar, type ScoreBar } from "../vision/overlay";
import type { OverlayTextReader } from "../vision/tinyOcr";
import { fingerprint, ShotTracker, type Shot } from "../vision/shots";
import { elapsedFor, fitStart, MATCH_S, phaseAt, type ClockReading, type Phase } from "../vision/matchClock";
import { sleep, type VideoSource } from "../video/source";
import { detect, detectTiled, iou, type Detection, type Infer } from "../vision/detector";
import { RobotTracker, type Track } from "../vision/tracker";
import { MotionModel } from "../vision/motion";
import { LaunchDetector, type Launch } from "../vision/launches";
import { allianceColour, cosine, embed, meanEmbedding, type EmbedInfer } from "../vision/appearance";
import { findHive, type HiveBoxes } from "../vision/hiveFinder";
import { HiveWatcher, hiveEvents, type HiveEvent, type HiveSample } from "../vision/hive";

// One pass over a located match: follows the clock, splits the video into camera shots,
// groups them into camera views, and works out how much of the match each view covers.
// When a detector model is available it also finds robots and balls and tracks the robots.

export interface TimedFrame { t: number; frame: Frame }

export interface ViewSummary {
  id: number;
  seconds: number;           // time on screen during the match
  shots: number;
  thumb: Frame | null;       // a representative frame (shown in the UI)
  live: boolean;             // false if the clock showed this wasn't live play (e.g. replay)
}

export interface MatchAnalysis {
  start: number;
  shots: Shot[];
  views: ViewSummary[];
  mainView: number | null;     // the view used for robot analysis
  mainCoverage: number;        // share of the match the main view was on screen
  clockChecks: { t: number; expected: number; read: number | null }[];
  phaseTimes: Record<Phase, number>; // seconds of video seen per phase
  framesAnalysed: number;
  robots: RobotSummary[];                                            // robot tracks (image coords for now)
  detections: { t: number; dets: Detection[] }[];                    // per analysed frame, during play
  hives: { view: number; boxes: HiveBoxes }[];                       // where the hive is, per camera view
  hiveEvents: (HiveEvent & { hive: "red" | "blue"; view: number })[]; // pollen scored (volleys) and tips, match time
}

export interface RobotSummary extends Pick<Track, "id" | "hits" | "path"> {
  view: number;
  embedding: Float32Array | null;   // appearance (alliance colours removed), for identification
  red: number; blue: number;        // share of red / blue alliance-marking pixels
  crop: Frame | null;               // the clearest picture of it (shown when asking which robot is the team)
  launches: { t: number; x: number; y: number; strong: boolean; feat?: Launch["feat"] }[]; // balls that left it (stream time, where it left)
}

export interface AnalyzeOptions {
  sampleEvery: number;       // seconds of stream time between frames
  clockEvery: number;        // seconds between clock reads
  infer?: Infer;             // detector model; without it only clock + cameras are analysed
  embedInfer?: EmbedInfer;   // appearance model for robot identification
  detectSize: number;        // detector input size
  tiles: boolean;            // also look at the far side zoomed in (small robots far away); ~3x the detector cost
}

const WEAK_ROBOT = 0.08, SURE_ROBOT = 0.35;

export async function analyzeMatch(
  frames: AsyncIterable<TimedFrame>, start: number, reader: OverlayTextReader,
  opts: Partial<AnalyzeOptions> = {}, onProgress?: (elapsed: number) => void,
): Promise<MatchAnalysis> {
  const o: AnalyzeOptions = { sampleEvery: 0.33, clockEvery: 3, detectSize: 640, tiles: true, ...opts };
  const robots: MatchAnalysis["robots"] = [];
  const detections: MatchAnalysis["detections"] = [];
  let robotTracker = new RobotTracker(), trackView = -1;
  // launches see every frame (~10 fps); robot detection only every sampleEvery seconds
  let launcher = new LaunchDetector();
  const launchesOf = new Map<number, MatchAnalysis["robots"][number]["launches"]>(); // tracker track id → launches
  const motion = new Map<number, MotionModel>(); // one background per camera view
  // a few clean crops per track, early in the match (robots apart, at their start spots)
  const crops = new Map<Track, { e: Float32Array[]; red: number; blue: number; n: number; best: Frame | null; area: number }>();
  const closeTracks = () => {
    for (const tr of robotTracker.tracks) {
      if (tr.hits < 3) continue;
      const c = crops.get(tr);
      robots.push({
        id: robots.length, hits: tr.hits, path: tr.path, view: trackView,
        embedding: c?.e.length ? meanEmbedding(c.e) : null, red: c ? c.red / c.n : 0, blue: c ? c.blue / c.n : 0,
        crop: c?.best ?? null, launches: launchesOf.get(tr.id) ?? [],
      });
    }
    crops.clear();
    launchesOf.clear();
  };
  const tracker = new ShotTracker();
  const thumbs = new Map<number, Frame>();
  const thumbAt = new Map<number, number>();
  const samples: { t: number; view: number }[] = [];
  const readings: (ClockReading & { view: number })[] = [];
  let bar: ScoreBar | null = null, lastClock = -Infinity, lastT: number | null = null, n = 0;
  // the hive, per camera view: found once from the picture, then watched on every frame (cheap)
  type HiveState = { boxes: HiveBoxes; watch: Record<"red" | "blue", HiveWatcher>; samples: Record<"red" | "blue", HiveSample[]>; tries: number; lastTry: number };
  const hives = new Map<number, HiveState>();
  const hiveTries = new Map<number, { n: number; last: number; finds: HiveBoxes[] }>();
  let curView = -1;
  const watchBox = (b: HiveBoxes, which: "red" | "blue") => {
    // both see-saws share the hive's height; balls can sit in the lower cell too
    const y0 = Math.min(b.red.y, b.blue.y), y1 = Math.max(b.red.y + b.red.h, b.blue.y + b.blue.h);
    const box = which === "red" ? b.red : b.blue;
    return { x: box.x, y: y0, w: box.w, h: (y1 - y0) * 1.15 };
  };

  let frameW = 1280;
  for await (const { t, frame } of frames) {
    frameW = frame.width;
    const elapsed = t - start;
    if (elapsed > MATCH_S + 2) break;
    if (curView >= 0) {
      let hs = hives.get(curView);
      // find the hive from just before the start: a look every 2.5 s, up to 14; the watch starts when 3 looks
      // agree (the finder misses or grabs the wrong red thing on some frames, e.g. a red shirt behind the hive)
      const tries = hiveTries.get(curView) ?? { n: 0, last: -Infinity, finds: [] as HiveBoxes[] };
      if (!hs && elapsed >= -3 && tries.n < 14 && t - tries.last >= 2.5) {
        tries.n++; tries.last = t; hiveTries.set(curView, tries);
        const found = findHive(frame);
        if (found && plausibleHive(found, frame.width)) tries.finds.push(found);
        const agreed = largestAgreeing(tries.finds);
        if (agreed.length >= 3 || (agreed.length >= 2 && tries.n >= 12)) {
          const boxes = medianHive(agreed);
          hs = { boxes, watch: { red: new HiveWatcher(watchBox(boxes, "red")), blue: new HiveWatcher(watchBox(boxes, "blue")) }, samples: { red: [], blue: [] }, tries: tries.n, lastTry: t };
          hives.set(curView, hs);
        }
      }
      // the first half second after the hive is found teaches the watcher the yellow that is always there
      const robotBoxes = robotTracker.tracks.filter(tr => tr.confirmed && t - tr.lastSeen <= 0.6).map(tr => tr.box);
      if (hs && t - hs.lastTry < 0.5) { for (const h of ["red", "blue"] as const) hs.watch[h].learnStill(frame); }
      else      if (hs) for (const h of ["red", "blue"] as const) { if (elapsed < -0.5) hs.watch[h].learnStill(frame); else hs.samples[h].push(hs.watch[h].push(elapsed, frame, robotBoxes)); }
    }
    if (o.infer && bar && elapsed >= 0 && elapsed <= MATCH_S) {
      const live = robotTracker.tracks.filter(tr => tr.confirmed && t - tr.lastSeen <= 0.6).map(tr => ({ id: tr.id, box: tr.box }));
      for (const l of launcher.push(t, frame, live, roiOf(frame, bar))) {
        const list = launchesOf.get(l.robot) ?? [];
        list.push({ t: l.t, x: l.x, y: l.y, strong: l.strong, ...(l.feat ? { feat: l.feat } : {}) });
        launchesOf.set(l.robot, list);
      }
    }
    if (lastT !== null && t - lastT < o.sampleEvery * 0.8) continue;
    n++;
    // the overlay is found again now and then: it can come and go between shots
    if (!bar || n % 10 === 0) bar = findScoreBar(frame) ?? bar;
    const mask = bar ? [bar.bar, bar.banner] : [];
    const { cut, view } = tracker.push(t, fingerprint(frame, mask));
    curView = view;
    // the picture shown for a view: one from mid-play when there is one (before the start people
    // are still on the field)
    if ((cut && !thumbs.has(view)) || (elapsed >= 40 && elapsed < 60 && (thumbAt.get(view) ?? -Infinity) < 40)) {
      thumbs.set(view, frame); thumbAt.set(view, elapsed);
    }
    samples.push({ t, view });
    lastT = t;

    if (o.infer && elapsed >= 0 && elapsed <= MATCH_S) {
      // a camera cut breaks robot tracks: positions on screen no longer line up
      if (cut || view !== trackView) { closeTracks(); robotTracker = new RobotTracker(); launcher = new LaunchDetector(); trackView = view; }
      // look only at the picture, not the overlay
      const roi = bar ? roiOf(frame, bar) : undefined;
      const mm = motion.get(view) ?? new MotionModel();
      motion.set(view, mm);
      mm.push(t, frame);
      // weak robot detections count when the box is over something moving (see motion.ts)
      const dets = (await (o.tiles ? detectTiled : detect)(frame, o.infer, { size: o.detectSize, roi, minScore: { robot: WEAK_ROBOT } }))
        .filter(d => d.cls !== "robot" || d.score >= SURE_ROBOT || (mm.moving(d) ?? 0) >= 0.25);
      const seen = robotTracker.update(t, dets, frame);
      detections.push({ t, dets });
      if (o.embedInfer) {
        const robotsNow = dets.filter(d => d.cls === "robot");
        for (const tr of seen) {
          const c = crops.get(tr) ?? { e: [], red: 0, blue: 0, n: 0, best: null, area: 0 };
          crops.set(tr, c);
          // only crops that don't overlap another robot
          // up to 5 crops per track; after the first 20 s only every few frames (cheaper)
          // (a duplicate box on the same robot doesn't count as another robot in the way; and every
          // track gets at least one crop, or it could never be identified)
          const blocked = c.e.length > 0 && robotsNow.some(d => d.x !== tr.box.x && covers(d, tr.box) > 0.25 && iou(d, tr.box) < 0.5);
          if (c.e.length >= 5 || (elapsed >= 20 && c.e.length > 0 && (n % 6 !== 0 || c.e.length >= 2)) || blocked) continue;
          c.e.push(await embed(frame, tr.box, o.embedInfer));
          // the biggest clean view of it, with a little margin
          if (tr.box.w * tr.box.h > c.area) {
            c.area = tr.box.w * tr.box.h;
            const m = 0.15 * Math.max(tr.box.w, tr.box.h);
            const x = Math.max(0, tr.box.x - m), y = Math.max(0, tr.box.y - m);
            c.best = crop(frame, { x, y, w: Math.min(frame.width - x, tr.box.w + 2 * m), h: Math.min(frame.height - y, tr.box.h + 2 * m) });
          }
          const col = allianceColour(frame, tr.box);
          c.red += col.red; c.blue += col.blue; c.n++;
        }
      }
    }

    if (bar && t - lastClock >= o.clockEvery) {
      lastClock = t;
      const nowBar = findScoreBar(frame);
      const read = nowBar ? await reader.readClock(frame, nowBar) : null;
      if (read !== null) readings.push({ t, clock: read, view });
    }
    onProgress?.(elapsed);
  }

  closeTracks();
  // scenery the detector boxes as a robot (posts, hive legs) sits in one spot all match; a robot
  // moves within a minute. Dropping it here also drops "launches" from the posts' yellow tops.
  const merged = linkTracks(robots).filter(r => !isScenery(r));
  // launches must start on the field: its outline = every ball seen this match (drive teams and people
  // behind the walls are outside it)
  const field = hull(detections.flatMap(d => d.dets.filter(x => x.cls !== "robot").map(x => ({ x: x.x + x.w / 2, y: x.y + x.h }))));
  if (field.length >= 3) for (const r of merged) r.launches = r.launches.filter(l => insideGrown(field, l, 1.05));
  // regroup shots into camera views now that every shot is complete; sample views follow
  const before = tracker.shots.map(s => s.view);
  tracker.finish();
  const remap = new Map(before.map((v, i) => [v, tracker.shots[i].view]));
  for (const s of samples) s.view = remap.get(s.view) ?? s.view;
  for (const r of readings) r.view = remap.get(r.view) ?? r.view;
  const firstThumb = new Map<number, Frame>();
  for (const [v, f] of thumbs) { const nv = remap.get(v) ?? v; if (!firstThumb.has(nv)) firstThumb.set(nv, f); }

  // The locator's start can be a second or two off: refit it from every clock read in this pass.
  start = fitStart(readings, start) ?? start;
  const clockChecks: MatchAnalysis["clockChecks"] = [];
  const notLive = new Map<number, number>();
  for (const r of readings) {
    const elapsed = r.t - start;
    if (elapsed < 1 || elapsed > MATCH_S - 1) continue;
    clockChecks.push({ t: r.t, expected: expectedClock(elapsed), read: r.clock });
    // a clock that disagrees with the match timeline = replay or delayed feed on this view
    if (Math.abs(elapsedFor(r.clock, elapsed) - elapsed) > 4) notLive.set(r.view, (notLive.get(r.view) ?? 0) + 1);
  }
  const phaseTimes: Record<Phase, number> = { pre: 0, auto: 0, transition: 0, teleop: 0, post: 0 };
  for (let i = 1; i < samples.length; i++) phaseTimes[phaseAt(samples[i].t - start)] += samples[i].t - samples[i - 1].t;

  const time = tracker.viewTime();
  const views: ViewSummary[] = [...time.entries()].map(([id, seconds]) => ({
    id, seconds, shots: tracker.shots.filter(s => s.view === id).length, thumb: firstThumb.get(id) ?? null,
    live: (notLive.get(id) ?? 0) === 0,
  })).sort((a, b) => b.seconds - a.seconds);
  const main = views.find(v => v.live) ?? null;
  const hiveOut: MatchAnalysis["hives"] = [], hiveEv: MatchAnalysis["hiveEvents"] = [];
  for (const [v, hs] of hives) {
    const nv = remap.get(v) ?? v;
    hiveOut.push({ view: nv, boxes: hs.boxes });
    // robots driving through the hive box = the camera looks down on the hive: count discs instead of area
    const union = { x: Math.min(hs.boxes.red.x, hs.boxes.blue.x), y: Math.min(hs.boxes.red.y, hs.boxes.blue.y), x1: Math.max(hs.boxes.red.x + hs.boxes.red.w, hs.boxes.blue.x + hs.boxes.blue.w), y1: Math.max(hs.boxes.red.y + hs.boxes.red.h, hs.boxes.blue.y + hs.boxes.blue.h) };
    const pts = merged.filter(r => (remap.get(r.view) ?? r.view) === nv).flatMap(r => r.path);
    const inside = pts.filter(p => p.x >= union.x && p.x <= union.x1 && p.y - 0.45 * p.s >= union.y && p.y - 0.45 * p.s <= union.y1).length;
    const mode = pts.length >= 50 && inside / pts.length >= 0.08 ? "discs" : "area";
    for (const h of ["red", "blue"] as const) {
      // one ball's area: the box-size guess is a floor (from the side, lone blobs are often fragments of balls
      // half hidden behind the panel); looking down, lone balls are whole discs and much bigger than the guess
      const guess = ballAreaFor(hs.boxes[h], frameW), seen = hs.watch[h].ballArea();
      const ballArea = seen !== null ? Math.max(guess, Math.min(4 * guess, seen)) : guess;
      for (const e of hiveEvents(hs.samples[h], ballArea, 0.6, mode).events) hiveEv.push({ ...e, hive: h, view: nv });
    }
  }
  hiveEv.sort((a, b) => a.t - b.t);
  return {
    start, shots: tracker.shots, views, mainView: main?.id ?? null, hives: hiveOut, hiveEvents: hiveEv,
    mainCoverage: main ? Math.min(1, main.seconds / MATCH_S) : 0,
    clockChecks, phaseTimes, framesAnalysed: n,
    robots: merged.map(r => ({ ...r, view: remap.get(r.view) ?? r.view })), detections,
  };
}

/** Two see-saws of similar size, side by side, not overlapping, neither absurdly large. */
function plausibleHive(h: HiveBoxes, W: number) {
  const r = h.red, b = h.blue, ratio = r.w / Math.max(1, b.w);
  if (ratio < 0.6 || ratio > 1.6) return false;
  if (b.h < 0.4 * r.h || r.h < 0.4 * b.h) return false;      // a sliver is not the other see-saw
  if (r.w > 0.22 * W || b.w > 0.22 * W) return false;
  const overlap = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x);
  return overlap < 0.3 * Math.min(r.w, b.w);
}
/** The biggest set of looks that agree on the red box (centre within 25% of its width, size within 30%). */
function largestAgreeing(hs: HiveBoxes[]): HiveBoxes[] {
  let best: HiveBoxes[] = [];
  for (const a of hs) {
    const grp = hs.filter(b => {
      const cx = Math.abs((b.red.x + b.red.w / 2) - (a.red.x + a.red.w / 2)), cy = Math.abs((b.red.y + b.red.h / 2) - (a.red.y + a.red.h / 2));
      return cx <= 0.25 * a.red.w && cy <= 0.25 * a.red.h && b.red.w / a.red.w >= 0.7 && b.red.w / a.red.w <= 1.43;
    });
    if (grp.length > best.length) best = grp;
  }
  return best;
}
function medianHive(hs: HiveBoxes[]): HiveBoxes {
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const box = (k: "red" | "blue") => ({ x: med(hs.map(h => h[k].x)), y: med(hs.map(h => h[k].y)), w: med(hs.map(h => h[k].w)), h: med(hs.map(h => h[k].h)) });
  return { red: box("red"), blue: box("blue") };
}

/** Yellow pixels of one resting ball: ~100 at 720p for a hive box ~145 px wide (Oregon side camera); scales with the box. */
function ballAreaFor(box: { w: number }, frameW: number) { return Math.max(40, Math.min(400, 100 * (box.w / 145) ** 2 * (1280 / frameW) ** 0)); }

/**
 * Join track pieces of the same robot (it was hidden for a moment, so the tracker started a new
 * track): B continues A if it starts soon after A ends, near where A ended, and looks the same.
 */
export function linkTracks(rs: RobotSummary[]): RobotSummary[] {
  const byStart = [...rs].sort((a, b) => a.path[0].t - b.path[0].t);
  const out: RobotSummary[] = [];
  for (const r of byStart) {
    let best: RobotSummary | null = null, bestScore = 0;
    for (const a of out) {
      if (a.view !== r.view) continue;
      const end = a.path[a.path.length - 1], start = r.path[0];
      const gap = start.t - end.t;
      if (gap <= 0 || gap > 6) continue;
      const dist = Math.hypot(start.x - end.x, start.y - end.y);
      if (dist > 120 + 150 * gap) continue; // ~ a robot's top speed on screen
      const look = a.embedding && r.embedding ? cosine(a.embedding, r.embedding) : 0.7;
      if (look < 0.7) continue;
      const score = look - dist / 2000 - gap / 20;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (!best) { out.push({ ...r, path: [...r.path], launches: [...r.launches] }); continue; }
    best.path.push(...r.path);
    best.hits += r.hits;
    best.launches = [...best.launches, ...r.launches];
    if (r.embedding && best.embedding) best.embedding = meanEmbedding([best.embedding, r.embedding]);
    best.embedding ??= r.embedding;
    best.red = (best.red + r.red) / 2; best.blue = (best.blue + r.blue) / 2;
  }
  return out.map((r, i) => ({ ...r, id: i }));
}

/** The picture without the overlay (the score bar is at the top or the bottom). */
function roiOf(frame: Frame, bar: ScoreBar) {
  return bar.bar.y > frame.height / 2
    ? { x: 0, y: 0, w: frame.width, h: bar.banner.y }
    : { x: 0, y: bar.bar.y + bar.bar.h, w: frame.width, h: frame.height - bar.bar.y - bar.bar.h };
}

/** Share of b that a covers. */
function covers(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (b.w * b.h || 1) : 0;
}


function expectedClock(elapsed: number) {
  if (elapsed < 30) return 150 - Math.floor(elapsed);
  if (elapsed < 38) return 38 - Math.floor(elapsed);
  return Math.max(0, 158 - Math.ceil(elapsed));
}

/** Browser: play the source and sample frames while it plays. */
export async function* playFrames(src: VideoSource, from: number, to: number, rate: number, every: number): AsyncGenerator<TimedFrame> {
  await src.seek(from);
  await src.play(rate);
  try {
    let last = -Infinity;
    while (src.currentTime() < to) {
      const t = src.currentTime();
      if (t - last >= every) {
        const frame = await src.grab();
        if (frame) { last = t; yield { t, frame }; }
      }
      await sleep(15);
    }
  } finally {
    src.pause();
  }
}

function isScenery(r: RobotSummary) {
  const p = r.path;
  if (p.length < 10 || p[p.length - 1].t - p[0].t < 60) return false;
  const s = [...p.map(q => q.s)].sort((a, b) => a - b)[p.length >> 1] || 1;
  const xs = p.map(q => q.x).sort((a, b) => a - b), ys = p.map(q => q.y).sort((a, b) => a - b);
  const q = (v: number[], k: number) => v[Math.floor(k * (v.length - 1))];
  return Math.hypot(q(xs, 0.95) - q(xs, 0.05), q(ys, 0.95) - q(ys, 0.05)) < 0.5 * s;
}

/** Convex hull (monotone chain). */
function hull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: typeof p = [], up: typeof p = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Point inside the polygon grown by factor k around its centre. */
function insideGrown(poly: { x: number; y: number }[], p: { x: number; y: number }, k: number) {
  const cx = poly.reduce((a, q) => a + q.x, 0) / poly.length, cy = poly.reduce((a, q) => a + q.y, 0) / poly.length;
  const g = poly.map(q => ({ x: cx + (q.x - cx) * k, y: cy + (q.y - cy) * k }));
  let inside = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    if ((g[i].y > p.y) !== (g[j].y > p.y) && p.x < ((g[j].x - g[i].x) * (p.y - g[i].y)) / (g[j].y - g[i].y) + g[i].x) inside = !inside;
  }
  return inside;
}
