import { useEffect, useMemo, useRef, useState } from "react";
import { streamFor, teamMatches, youtubeId, type TeamMatch, type TeamSummary } from "../api/ftcscout";
import { benchmark, estimate, fmtDuration, type Benchmark } from "../analysis/estimate";
import { runStream, type MatchStatus } from "../analysis/run";
import { frameToDataUrl, toReport } from "../analysis/report";
import { cancelJob, getJob, helperAvailable, listJobs, startJob, type HelperMatchStatus } from "../api/helper";
import { fmt } from "../analysis/locate";
import { YouTubeSource, tabCaptureSupported } from "../video/youtubeSource";
import { FileSource } from "../video/fileSource";
import type { VideoSource } from "../video/source";
import { MatchResult } from "./MatchResult";
import { TeamStats } from "./TeamStats";
import { ConfirmRobot } from "./ConfirmRobot";

interface Group { id: string; label: string; matches: TeamMatch[]; link: string; file: File | null }
type Mode = "helper" | "screen";

// jobs started on the helper are remembered per team, so reopening the page picks them up again
const jobsKey = (team: number) => `ftcscout.jobs.${team}`;
function savedJobs(team: number): string[] {
  try { return JSON.parse(localStorage.getItem(jobsKey(team)) ?? "[]"); } catch { return []; }
}
function saveJobs(team: number, ids: string[]) {
  try { localStorage.setItem(jobsKey(team), JSON.stringify(ids.slice(-20))); } catch { /* private mode */ }
}

export function TeamView({ number }: { number: number }) {
  const [team, setTeam] = useState<TeamSummary | null>(null);
  const [matches, setMatches] = useState<TeamMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(5);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [status, setStatus] = useState<Record<string, HelperMatchStatus>>({});
  const [jobOf, setJobOf] = useState<Record<string, string>>({}); // match → helper job that analysed it
  const [helper, setHelper] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("helper");
  const [jobIds, setJobIds] = useState<string[]>(() => savedJobs(number));
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const playerHost = useRef<HTMLDivElement>(null);
  const yt = useRef<YouTubeSource | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    teamMatches(number).then(r => { setTeam(r.team); setMatches(r.matches); }).catch(e => setError(e.message));
    benchmark().then(setBench);
    return () => { abort.current?.abort(); yt.current?.dispose(); };
  }, [number]);

  // jobs the helper already ran for this team's matches (started from another browser or a script)
  useEffect(() => {
    if (!helper || matches.length === 0) return;
    let alive = true;
    (async () => {
      const keys = new Set(matches.map(m => m.key));
      const found: string[] = [];
      for (const j of await listJobs().catch(() => [])) {
        const full = await getJob(j.id).catch(() => null);
        if (full && Object.keys(full.status).some(k => keys.has(k))) found.push(j.id);
      }
      if (alive && found.length) setJobIds(p => (found.every(id => p.includes(id)) ? p : [...new Set([...p, ...found])]));
    })();
    return () => { alive = false; };
  }, [helper, matches]);

  // look for the helper now and then, so starting it later just works
  useEffect(() => {
    let alive = true;
    const check = () => helperAvailable().then(ok => { if (alive) setHelper(ok); });
    check();
    const t = setInterval(check, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // follow helper jobs (also ones started before this page was opened)
  useEffect(() => {
    if (!helper || jobIds.length === 0) return;
    let alive = true;
    const poll = async () => {
      let busy = false;
      const lines: string[] = [];
      for (const id of jobIds) {
        const j = await getJob(id).catch(() => null);
        if (!j || !alive) continue;
        setStatus(p => ({ ...p, ...j.status }));
        setJobOf(p => ({ ...p, ...Object.fromEntries(Object.keys(j.status).map(k => [k, id])) }));
        lines.push(...j.log.filter(l => !l.startsWith("look")));
        if (j.error) lines.push(`error: ${j.error}`);
        if (j.state === "queued" || j.state === "running") busy = true;
      }
      if (!alive) return;
      setLog(lines.slice(-100));
      setRunning(busy);
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [helper, jobIds]);

  const played = useMemo(() => matches.filter(m => m.played), [matches]);
  const selected = useMemo(() => played.slice(-count), [played, count]);

  // matches that share a stream are analysed together (one anchor per stream)
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const m of selected) {
      const auto = streamFor(m) ?? "";
      const id = `${m.eventCode}|${auto || m.actualStartTime?.slice(0, 10)}`;
      const g = map.get(id) ?? { id, label: m.event.name, matches: [], link: links[id] ?? auto, file: files[id] ?? null };
      g.matches.push(m);
      map.set(id, g);
    }
    return [...map.values()];
  }, [selected, links, files]);

  const useHelper = mode === "helper" && !!helper;
  const usable = groups.filter(g => g.file || youtubeId(g.link));
  const linkMode = !useHelper && usable.some(g => !g.file);
  const est = bench ? estimate(bench, usable.reduce((n, g) => n + g.matches.length, 0), useHelper ? "helper" : linkMode ? "youtube" : "file") : null;

  async function startHelper() {
    setLog([]);
    const ids: string[] = [];
    for (const g of usable) {
      const id = youtubeId(g.link);
      if (!id) continue;
      for (const m of g.matches) setStatus(p => ({ ...p, [m.key]: { state: "waiting" } }));
      try { ids.push(await startJob(id, g.matches)); }
      catch (e) { setLog(l => [...l, `${g.label}: ${(e as Error).message}`]); }
    }
    const all = [...jobIds, ...ids];
    setJobIds(all);
    saveJobs(number, all);
    setRunning(ids.length > 0);
  }

  async function stop() {
    abort.current?.abort();
    if (useHelper) await Promise.all(jobIds.map(id => cancelJob(id).catch(() => {})));
  }

  async function start() {
    if (useHelper) return startHelper();
    setRunning(true);
    setLog([]);
    const ac = new AbortController();
    abort.current = ac;
    const say = (m: string) => setLog(l => [...l.slice(-200), m]);
    const set = async (k: string, s: MatchStatus) => {
      const ui: HelperMatchStatus = s.state === "done" ? { state: "done", start: s.start, report: await toReport(s.analysis, frameToDataUrl, s.identity) } : s;
      setStatus(p => ({ ...p, [k]: ui }));
    };
    for (const g of groups) for (const m of g.matches) set(m.key, { state: "waiting" });
    try {
      // the share prompt has to come straight from the click, before anything slow happens
      const tab = linkMode && !yt.current ? await YouTubeSource.requestTab() : null;
      for (const g of usable) {
        if (ac.signal.aborted) break;
        let src: VideoSource;
        if (g.file) {
          src = await FileSource.open(g.file);
        } else {
          const id = youtubeId(g.link)!;
          if (!yt.current) {
            yt.current = await YouTubeSource.open(playerHost.current!, id);
            await yt.current.attach(tab!);
          } else {
            await yt.current.load(id);
          }
          src = yt.current;
        }
        say(`${g.label}: ${g.matches.length} match(es)`);
        await runStream(src, g.matches, set, say, ac.signal);
        if (src !== yt.current) src.dispose();
      }
    } catch (e) {
      say(`Stopped: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!team) return <p className="muted">Loading team…</p>;

  return (
    <div className="team">
      <h1>{team.number} <span>{team.name}</span></h1>

      <section className="card">
        <h2>Matches</h2>
        {played.length === 0 ? <p className="muted">No played BIOBUZZ matches yet.</p> : (
          <>
            <label className="row">
              Analyse the last
              <input type="number" min={1} max={played.length} value={Math.min(count, played.length)}
                onChange={e => setCount(Math.max(1, Math.min(played.length, +e.target.value || 1)))} />
              of {played.length} played matches
            </label>
            <table className="matches">
              <thead><tr><th>Event</th><th>Match</th><th>Alliance</th><th>Partner</th><th>Opponents</th><th>Status</th></tr></thead>
              <tbody>
                {[...selected].reverse().map(m => {
                  const partner = m.teams.filter(t => t.alliance === m.alliance && t.teamNumber !== number).map(t => t.teamNumber);
                  const opp = m.teams.filter(t => t.alliance !== m.alliance).map(t => t.teamNumber);
                  return (
                    <tr key={m.key}>
                      <td>{m.event.name}</td>
                      <td>{m.description}</td>
                      <td><span className={`pill ${m.alliance.toLowerCase()}`}>{m.alliance}</span></td>
                      <td>{partner.join(", ")}</td>
                      <td>{opp.join(", ")}</td>
                      <td><StatusCell s={status[m.key]} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      {groups.length > 0 && (
        <section className="card">
          <h2>Video</h2>
          {groups.map(g => (
            <div key={g.id} className="stream">
              <div className="stream-head"><b>{g.label}</b> <span className="muted">{g.matches.map(m => m.description).join(", ")}</span></div>
              <div className="row wrap">
                <input className="grow" placeholder="YouTube link of the event stream" value={g.link}
                  onChange={e => setLinks(l => ({ ...l, [g.id]: e.target.value }))} disabled={running} />
                <label className="file">or a video file
                  <input type="file" accept="video/*" disabled={running}
                    onChange={e => setFiles(f => ({ ...f, [g.id]: e.target.files?.[0] ?? null }))} />
                </label>
              </div>
              {!g.file && g.link && !youtubeId(g.link) && (
                <p className="warn">This isn't a YouTube video link. Open it, copy the YouTube link of the stream, and paste it here.</p>
              )}
              {!g.file && !g.link && <p className="warn">No stream link listed for this event. Paste one or pick a file.</p>}
            </div>
          ))}
          <div className="modes">
            {helper ? (
              <label><input type="radio" checked={mode === "helper"} onChange={() => setMode("helper")} disabled={running} />
                {" "}<b>In the background</b> (FTC Scout helper is running on this computer). You can close this tab and come back later.</label>
            ) : (
              <div className="helper-off">
                <b>Run it in the background:</b> start the FTC Scout helper on this computer, then this page picks it up by itself.
                <pre>cd ftc-scout/app{"\n"}npm run helper</pre>
              </div>
            )}
            <label><input type="radio" checked={mode === "screen" || !helper} onChange={() => setMode("screen")} disabled={running || !helper} />
              {" "}Without the helper: play the video here and share this tab or window (keep it open), or use a video file.</label>
          </div>
          {linkMode && !tabCaptureSupported() && (
            <p className="warn">Link mode needs a desktop browser. On a phone, pick video files instead.</p>
          )}
          {est && usable.length > 0 && (
            <p className="estimate">
              Estimate: <b>{fmtDuration(est.seconds)}</b> ({fmtDuration(est.perMatch)} per match)
              {(linkMode || useHelper) && <> · about <b>{Math.round(est.megabytes)} MB</b> of streaming, nothing saved to disk</>}
              {est.limitedBy === "device" && <> · limited by this device's speed</>}
            </p>
          )}
          <div className="row">
            <button className="primary" disabled={running || usable.length === 0} onClick={start}
              title={linkMode ? "Your browser will ask to share this tab: choose this tab" : undefined}>
              {running ? "Analysing…" : "Start analysis"}
            </button>
            {running && <button onClick={stop}>Stop</button>}
          </div>
          <div ref={playerHost} className={`player ${linkMode && (running || yt.current) ? "" : "hidden"}`} />
          {linkMode && <p className="muted small">Your browser asks to share <b>this tab</b> (or this window), so the app can see the video player. Keep it open and visible while it runs.</p>}
          {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
        </section>
      )}

      <ConfirmRobot team={number} matches={[...selected].reverse()} status={status} jobOf={jobOf} />
      <TeamStats matches={[...selected].reverse()} status={status} />

      {selected.some(m => status[m.key]?.state === "done") && (
        <section className="card">
          <h2>Match by match</h2>
          {[...selected].reverse().map(m => {
            const s = status[m.key];
            if (s?.state !== "done") return null;
            const link = groups.find(g => g.matches.includes(m))?.link;
            return <MatchResult key={m.key} match={m} report={s.report} youtube={link ? youtubeId(link) : null} />;
          })}
        </section>
      )}
    </div>
  );
}

function StatusCell({ s }: { s?: HelperMatchStatus }) {
  if (!s) return <span className="muted">—</span>;
  switch (s.state) {
    case "waiting": return <span className="muted">waiting</span>;
    case "locating": return <span>finding in stream…</span>;
    case "analysing": return <span>at {fmt(s.start)} · {Math.round(s.progress * 100)}%</span>;
    case "done": return <span className="ok">done · {fmt(s.start)}</span>;
    case "not-found": return <span className="warn-text">not in this stream</span>;
    case "error": return <span className="warn-text" title={s.message}>error: {s.message}</span>;
  }
}
