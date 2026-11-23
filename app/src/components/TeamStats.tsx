import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamMatch } from "../api/ftcscout";
import type { HelperMatchStatus } from "../api/helper";
import type { MatchReport } from "../analysis/report";
import { autoDistance, endgame, leftStart, pathOnField, robotStats, stops, type PathPoint, type RobotStats } from "../analysis/robotStats";
import { fieldHomography, type Pt } from "../vision/field";
import { drawAuto, FieldCorners, FieldHeatmap, Legend, savedCorners } from "./FieldMap";

// Team summary from the video: how the identified robot moved, match by match and overall.
// Movement is measured in robot lengths on the camera image (approximate feet), so it works
// on any camera; scores from the overlay or the API are never used.

interface Row { m: TeamMatch; r: MatchReport; s: RobotStats; sure: boolean; field: PathPoint[] | null }

/** The team's pollen scored: sure count, plus the unsure volleys as a range. */
export function scoredCell(r: MatchReport) {
  const sc = r.scoring;
  if (!sc) return <span className="muted">—</span>;
  if (!sc.attributed || !sc.team) return <span className="muted" title="the 1080p launch pass didn't run for this match">alliance only</span>;
  const t = sc.team;
  return t.unsure ? <span title={`${t.sure} from clear volleys, ${t.unsure} more from volleys that could be the partner's`}>{t.sure}–{t.sure + t.unsure}</span> : <span>{t.sure}</span>;
}

export function TeamStats({ matches, status }: { matches: TeamMatch[]; status: Record<string, HelperMatchStatus> }) {
  const done = matches.filter(m => status[m.key]?.state === "done");
  const events = [...new Set(done.map(m => m.eventCode))];
  // field corners per event (clicked once, kept in this browser)
  const [corners, setCorners] = useState<Record<string, Pt[] | null>>({});
  const [mapping, setMapping] = useState<string | null>(null);
  const cornersOf = (ev: string) => (ev in corners ? corners[ev] : savedCorners(ev));
  const rows: Row[] = useMemo(() => done.flatMap(m => {
    const st = status[m.key];
    if (st?.state !== "done" || !st.report.team?.stats) return [];
    const c = cornersOf(m.eventCode), h = c ? fieldHomography(c) : null;
    // with the field mapped, everything is measured in real feet on the floor
    const field = h ? pathOnField(st.report.team.path, h) : null;
    const s = (field && robotStats(field)) || st.report.team.stats;
    return [{ m, r: st.report, s, sure: !!st.report.confirmed, field }]; // sure = the user pointed at the robot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [done, status, corners]);

  if (done.length === 0) return null;
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2>Team from the video</h2>
        <p className="muted">{done.length} match(es) analysed, but the team's robot couldn't be followed yet.</p>
      </section>
    );
  }

  // only matches where the robot was followed most of the time count towards the averages
  const good = rows.filter(x => x.s.trackedPct >= 0.4);
  const thumbOf = (ev: string) => {
    const r = rows.find(x => x.m.eventCode === ev)?.r;
    return r?.views.find(v => v.id === r.mainView)?.thumbUrl ?? null;
  };
  // possible disconnects: long stops in teleop while in view (on the field when mapped, else on the image)
  const stopsOf = (x: Row) => stops(x.field ?? x.r.team!.path, x.r.team?.launches ?? []);
  const dead = (x: Row) => x.s.trackedPct >= 0.4 && x.s.movingPct < 0.05;
  const disconnected = good.filter(x => dead(x) || stopsOf(x).length > 0);
  const flags = (x: Row): string[] => {
    const f: string[] = [];
    if (!x.sure) f.push("robot not confirmed");
    if (x.s.trackedPct < 0.4) f.push("little video");
    return f;
  };
  const pathOf = (x: Row) => x.field ?? x.r.team!.path;
  const leave = (x: Row) => leftStart(pathOf(x));
  const end = (x: Row) => endgame(pathOf(x));
  // the usual auto: per alliance colour (the routine is mirrored on the other side), the path most others match
  const sameAuto = (x: Row): boolean | null => {
    const peers = rows.filter(y => y !== x && y.m.alliance === x.m.alliance && y.m.eventCode === x.m.eventCode);
    const ds = peers.map(y => autoDistance(pathOf(x), pathOf(y))).filter((d): d is number => d !== null);
    if (!ds.length) return null;
    return ds.filter(d => d <= 1.5).length * 2 >= ds.length;
  };
  const seenAuto = rows.filter(x => leave(x) !== null), seenEnd = rows.filter(x => end(x) !== null);
  const routine = rows.map(sameAuto).filter((v): v is boolean => v !== null);

  return (
    <section className="card">
      <h2>Team from the video</h2>
      <p className="muted small">
        Robot followed in {rows.length} of {done.length} analysed match(es).
        {good.length < rows.length && <> {rows.length - good.length} left out of the averages (followed for less than 40% of the match).</>}
      </p>
      {good.length > 0 && <div className="tiles">
        {seenAuto.length > 0 && <Tile label="Leaves start in auto" value={`${seenAuto.filter(x => leave(x)).length} of ${seenAuto.length}`} note="matches" />}
        {routine.length > 0 && <Tile label="Runs its usual auto" value={`${routine.filter(v => v).length} of ${routine.length}`} note="matches (same alliance side)" />}
        {seenEnd.length > 0 && <Tile label="Parked at the end" value={`${seenEnd.filter(x => end(x)!.parked).length} of ${seenEnd.length}`} note="still for the last 10 s" />}
        <Tile label="Possible disconnects" value={`${disconnected.length} of ${good.length}`} note="matches" />
        <Tile label="Video coverage" value={`${Math.round(good.reduce((a, x) => a + x.s.trackedPct, 0) / good.length * 100)}%`} />
      </div>}
      <p className="muted small">
        From the robot's path. Usual auto = the same route (within ~1.5 robot lengths) as in most of its other matches
        on the same alliance side. Possible disconnect = in view but not moving for 15 s or more during teleop (the last
        30 s don't count), or not moving at all. Launches = near-vertical ball smears leaving the robot, hand-checked at
        about 55% real on a low camera: treat them as a rough range, better on clearer streams.
      </p>

      <h3>Autonomous paths</h3>
      <div className="heatmaps">
        {events.map(ev => {
          const evRows = rows.filter(x => x.m.eventCode === ev);
          if (!evRows.length) return null;
          const title = evRows[0].m.event.name, thumb = thumbOf(ev);
          if (mapping === ev && thumb) {
            return <FieldCorners key={ev} event={ev} title={title} thumb={thumb}
              onDone={pts => { setCorners(c => ({ ...c, [ev]: pts })); setMapping(null); }} />;
          }
          const onField = evRows.filter(x => x.field);
          return (
            <div key={ev}>
              {onField.length
                ? <FieldHeatmap title={title} series={onField.map(x => ({ label: x.m.description, path: x.field! }))} />
                : <Heatmap title={title} thumb={thumb} series={evRows.map(x => ({ label: x.m.description, path: x.r.team!.path }))} />}
              {thumb && <button className="small-btn" onClick={() => setMapping(ev)}>{onField.length ? "Adjust field corners" : "Map the field (4 clicks)"}</button>}
            </div>
          );
        })}
      </div>

      <table className="matches">
        <thead><tr><th>Match</th><th>Alliance</th><th>Auto: left start</th><th>Usual auto</th><th>Pollen scored</th><th>Alliance pollen</th><th>End</th><th>Possible disconnect</th><th>Followed</th><th>Notes</th></tr></thead>
        <tbody>
          {rows.map(x => {
            const st = stopsOf(x);
            return (
              <tr key={x.m.key}>
                <td>{x.m.description}</td>
                <td><span className={`pill ${x.m.alliance.toLowerCase()}`}>{x.m.alliance}</span></td>
                <td>{leave(x) === null ? <span className="muted">not seen</span> : leave(x) ? "yes" : <span className="flag">⚑ no</span>}</td>
                <td>{sameAuto(x) === null ? <span className="muted">—</span> : sameAuto(x) ? "yes" : <span className="flag">⚑ different</span>}</td>
                <td>{scoredCell(x.r)}</td>
                <td>{x.r.scoring ? `${x.r.scoring.hive[x.m.alliance.toLowerCase() as "red" | "blue"].balls} (${x.r.scoring.hive[x.m.alliance.toLowerCase() as "red" | "blue"].tips} tips)` : "—"}</td>
                <td>{end(x) === null ? <span className="muted">not seen</span> : end(x)!.parked ? "parked" : "moving"}</td>
                <td>{x.s.trackedPct < 0.4 ? <span className="muted">can't tell</span>
                  : dead(x) ? <span className="flag">⚑ didn't move</span>
                  : st.length ? <span className="flag">⚑ {st.map(z => `stopped ${clock(z.from)}–${clock(z.to)}`).join(", ")}</span>
                  : "no"}</td>
                <td>{Math.round(x.s.trackedPct * 100)}%</td>
                <td>{flags(x).map(f => <span key={f} className="flag">⚑ {f}</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="tile"><span>{label}</span><b>{value}</b>{note && <span className="muted small">{note}</span>}</div>;
}

/** Auto paths over the camera picture, one colour per match. */
function Heatmap({ title, thumb, series }: { title: string; thumb: string | null; series: { label: string; path: PathPoint[] }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const W = 640, H = 360, k = W / 1280;
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    const draw = () => {
      ctx.fillStyle = "rgba(0,0,0,0.35)"; // dim the photo so the lines read
      ctx.fillRect(0, 0, W, H);
      drawAuto(ctx, series, p => p.x * k, p => p.y * k);
    };
    if (!thumb) { ctx.fillStyle = "#222"; ctx.fillRect(0, 0, W, H); draw(); return; }
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, W, H); draw(); };
    img.src = thumb;
  }, [thumb, series]);
  return (
    <figure className="heatmap">
      <canvas ref={ref} aria-label={`Autonomous paths at ${title}`} />
      <figcaption>{title}: autonomous paths on the camera picture. Dot = where it started. <Legend series={series} /></figcaption>
    </figure>
  );
}

/** Seconds into the match → the match clock as shown on the stream (teleop counts down from 2:00). */
function clock(t: number) {
  const left = t < 30 ? 150 - t : t < 38 ? 38 - t : 158 - t;
  const s = Math.max(0, Math.round(left));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
