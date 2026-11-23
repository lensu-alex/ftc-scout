// Job queue: one stream at a time, in the background. Results stay in memory while the helper runs.
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TeamMatch } from "../src/api/ftcscout";
import { identifyTeam, NO_VIDEO, runStream, type Analysed, type MatchStatus } from "../src/analysis/run";
import { toReport, type MatchReport } from "../src/analysis/report";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import type { Frame } from "../src/vision/frame";
import { NodeSource } from "./source";
import { disableHelperFallback, eventMatches, SEASON } from "../src/api/ftcscout";
import * as ftcEvents from "./ftcEvents";

disableHelperFallback(); // we are the helper: call FTC Events directly instead
const matchesOf = (e: string) => eventMatches(e).catch(err => {
  if (!ftcEvents.ftcEventsConfigured()) throw err;
  return ftcEvents.eventMatches(SEASON, e);
});
import { resolveStream } from "./youtube";
import { detectorAvailable, detectorSize, embedderAvailable, nodeEmbed, nodeInfer } from "./detector";

export type JobMatchStatus = Exclude<MatchStatus, { state: "done" }> | { state: "done"; start: number; report: MatchReport };

export interface Job {
  id: string;
  videoId: string;
  title?: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  error?: string;
  matches: TeamMatch[];
  status: Record<string, JobMatchStatus>;
  log: string[];
  created: number;
}

const jobs = new Map<string, Job>();
// full analyses (not sent to the page) and the user's answers, to re-identify after a confirmation
const analysed = new Map<string, Analysed>();
const answers = new Map<string, Map<string, number>>();
const extras = new Map<string, Map<string, number[]>>(); // more pictures of the same robot, per job and match
const aborts = new Map<string, AbortController>();
let queue: Promise<void> = Promise.resolve();

const png = (f: Frame) => sharp(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.length), { raw: { width: f.width, height: f.height, channels: 4 } });
const thumb = async (f: Frame) => `data:image/jpeg;base64,${(await png(f).resize(640, 360, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer()).toString("base64")}`;
const makeReader = () => new TinyOverlayReader();

export function createJob(videoId: string, matches: TeamMatch[]): Job {
  const id = Math.random().toString(36).slice(2, 10);
  const job: Job = { id, videoId, state: "queued", matches, status: {}, log: [], created: Date.now() };
  for (const m of matches) job.status[m.key] = { state: "waiting" };
  jobs.set(id, job);
  const ac = new AbortController();
  aborts.set(id, ac);
  queue = queue.then(() => run(job, ac.signal));
  return job;
}

async function run(job: Job, signal: AbortSignal) {
  if (signal.aborted) { job.state = "cancelled"; return; }
  job.state = "running";
  const say = (m: string) => { job.log.push(m); if (job.log.length > 300) job.log.shift(); };
  try {
    const s = await resolveStream(job.videoId);
    job.title = s.title;
    say(`stream: ${s.title}`);
    const src = new NodeSource(s.url, s.duration);
    const opts = {
      infer: detectorAvailable() ? nodeInfer : undefined, detectSize: detectorSize(),
      embedInfer: detectorAvailable() && embedderAvailable() ? nodeEmbed : undefined,
    };
    const done = await runStream(src, job.matches, async (key, st) => {
      job.status[key] = st.state === "done" ? { state: "done", start: st.start, report: await toReport(st.analysis, thumb, st.identity) } : st;
    }, say, signal, makeReader, (_s, from, to) => src.frames(from, to - from, 10) /* 10 fps: launches; robots are still detected at ~3 fps */, matchesOf, opts);
    // matches whose video couldn't be read (expired or throttled link): once more, with a fresh link
    const failed = job.matches.filter(m => job.status[m.key]?.state === "error" && (job.status[m.key] as { message: string }).message === NO_VIDEO);
    if (failed.length && !signal.aborted) {
      say(`retrying ${failed.length} match(es) with a fresh video link`);
      const s2 = await resolveStream(job.videoId, true);
      const src2 = new NodeSource(s2.url, s2.duration);
      const again = await runStream(src2, failed, async (key, st) => {
        job.status[key] = st.state === "done" ? { state: "done", start: st.start, report: await toReport(st.analysis, thumb, st.identity) } : st;
      }, say, signal, makeReader, (_s, from, to) => src2.frames(from, to - from, 10), matchesOf, opts);
      for (const [k, v] of again ?? []) done?.set(k, v);
      if (done && again?.size) await refresh(job, done, answers.get(job.id) ?? new Map());
    }
    if (done) {
      analysed.set(job.id, done);
      await reapplyAnswers(job, done);
    }
    job.state = signal.aborted ? "cancelled" : "done";
  } catch (e) {
    job.state = "error";
    job.error = (e as Error).message;
    say(`error: ${job.error}`);
  }
}

export const getJob = (id: string) => jobs.get(id);
export const listJobs = () => [...jobs.values()];
export function cancelJob(id: string) {
  aborts.get(id)?.abort();
  const j = jobs.get(id);
  if (j && j.state === "queued") j.state = "cancelled";
}

/** The user pointed at the team's robot in one match: fix it, remember it, and re-identify every match. */
export async function confirmRobot(id: string, matchKey: string, trackId: number, add = false) {
  const job = jobs.get(id), done = analysed.get(id);
  if (!job || !done?.has(matchKey)) throw new Error("nothing to confirm for this match");
  const known = answers.get(id) ?? new Map<string, number>();
  answers.set(id, known);
  const more = extras.get(id) ?? new Map<string, number[]>();
  extras.set(id, more);
  if (add && known.has(matchKey) && known.get(matchKey) !== -1) {
    more.set(matchKey, [...new Set([...(more.get(matchKey) ?? []), trackId])]);
  } else {
    known.set(matchKey, trackId);
    more.delete(matchKey);
  }
  const picks = await refresh(job, done, known, more);
  // saved as the path the robot drove (track ids change when a match is analysed again)
  const pick = picks.find(p => p.matchKey === matchKey);
  const robots = done.get(matchKey)!.analysis.robots.filter(r => (pick?.trackIds ?? [trackId]).includes(r.id));
  saveAnswer(teamOf(done.get(matchKey)!.m), matchKey, trackId === -1 ? { skip: true }
    : { path: robots.flatMap(r => r.path).filter((_, i) => i % 3 === 0).map(p => ({ t: +p.t.toFixed(2), x: Math.round(p.x), y: Math.round(p.y), s: Math.round(p.s) })) });
}

async function refresh(job: Job, done: Analysed, known: Map<string, number>, more = extras.get(job.id) ?? new Map<string, number[]>()) {
  const picks = identifyTeam(done, known, more);
  for (const pick of picks) {
    const d = done.get(pick.matchKey)!;
    job.status[pick.matchKey] = { state: "done", start: d.start, report: await toReport(d.analysis, thumb, pick, known.has(pick.matchKey)) };
  }
  return picks;
}

// ---- answers kept on disk (~/.ftc-scout/answers.json), so analysing a match again keeps them ----
type Saved = { skip: true } | { path: { t: number; x: number; y: number; s: number }[] };
const ANSWERS = join(homedir(), ".ftc-scout", "answers.json");
const teamOf = (m: TeamMatch) => m.teams.find(t => t.alliance === m.alliance && t.station === m.station)?.teamNumber ?? 0;
function loadAnswers(): Record<string, Saved> {
  try { return existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, "utf8")) : {}; } catch { return {}; }
}
function saveAnswer(team: number, matchKey: string, a: Saved) {
  const all = loadAnswers();
  all[`${team}/${matchKey}`] = a;
  mkdirSync(join(homedir(), ".ftc-scout"), { recursive: true });
  writeFileSync(ANSWERS, JSON.stringify(all));
}

/** After a run: find, in the new analysis, the robot that drove the saved path (same stream times). */
async function reapplyAnswers(job: Job, done: Analysed) {
  const all = loadAnswers(), known = answers.get(job.id) ?? new Map<string, number>();
  for (const [key, d] of done) {
    const a = all[`${teamOf(d.m)}/${key}`];
    if (!a) continue;
    if ("skip" in a) { known.set(key, -1); continue; }
    // every robot that drove a good part of the saved path: the best one is the answer, the others extras
    const hitsOf = (r: (typeof d.analysis.robots)[number]) => a.path.filter(p =>
      r.path.some(q => Math.abs(q.t - p.t) < 0.5 && Math.hypot(q.x - p.x, q.y - p.y) < Math.max(p.s, q.s))).length;
    const found = d.analysis.robots.map(r => ({ id: r.id, hits: hitsOf(r) })).filter(x => x.hits > 2).sort((x, y) => y.hits - x.hits);
    if (found.length) {
      known.set(key, found[0].id);
      const more = extras.get(job.id) ?? new Map<string, number[]>();
      extras.set(job.id, more);
      const enough = Math.max(5, 0.15 * a.path.length);
      // extras: other pieces of the same path, never on screen at the same time as one already taken
      const span = (id: number) => { const p = d.analysis.robots.find(r => r.id === id)!.path; return [p[0].t, p[p.length - 1].t]; };
      const taken = [span(found[0].id)], rest: number[] = [];
      for (const x of found.slice(1)) {
        if (x.hits < enough) continue;
        const [a0, a1] = span(x.id);
        if (taken.some(([b0, b1]) => a0 < b1 && b0 < a1)) continue;
        taken.push([a0, a1]); rest.push(x.id);
      }
      if (rest.length) more.set(key, rest);
    }
  }
  if (known.size) { answers.set(job.id, known); await refresh(job, done, known); }
}
