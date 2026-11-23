import type { TeamMatch } from "../api/ftcscout";
import type { MatchReport } from "../analysis/report";
import { fmt } from "../analysis/locate";
import { AUTO_S, TELEOP_S, TRANSITION_S } from "../vision/matchClock";
import { autoSegments } from "../analysis/robotStats";

export function MatchResult({ match, report: a, youtube }: { match: TeamMatch; report: MatchReport; youtube: string | null }) {
  const seenAuto = a.phaseTimes.auto / AUTO_S, seenTeleop = a.phaseTimes.teleop / TELEOP_S;
  const okClock = a.clockChecks.filter(c => c.read !== null && Math.abs(c.read - c.expected) <= 2).length;
  return (
    <article className="result">
      <header>
        <b>{match.description}</b> · {match.event.name} · <span className={`pill ${match.alliance.toLowerCase()}`}>{match.alliance}</span>
        {youtube && <a href={`https://www.youtube.com/watch?v=${youtube}&t=${Math.floor(a.start)}s`} target="_blank" rel="noreferrer">watch from {fmt(a.start)}</a>}
      </header>
      <div className="facts">
        <Fact label="Match start in stream" value={fmt(a.start)} />
        <Fact label="Auto seen" value={pct(seenAuto)} />
        <Fact label="Teleop seen" value={pct(seenTeleop)} />
        <Fact label="Main camera covers" value={pct(a.mainCoverage)} />
        <Fact label="Camera views" value={String(a.views.length)} />
        <Fact label="Camera cuts" value={String(a.cuts)} />
        <Fact label="Clock checks OK" value={`${okClock}/${a.clockChecks.length}`} />
        {a.robotsTracked !== undefined && <Fact label="Robots tracked" value={String(a.robotsTracked)} />}
        {a.team?.launchEstimate && <Fact label="Launches (rough)" value={`≈ ${a.team.launchEstimate.est} (${a.team.launchEstimate.low}–${a.team.launchEstimate.high})`} />}
        {a.team !== undefined && (
          <Fact label="Team robot" value={a.confirmed ? (a.team ? "your choice" : "left out by you") : !a.team ? "not found" : `app's guess (${pct(a.team.confidence)})`} />
        )}
      </div>
      <div className="views">
        {a.views.map(v => (
          <figure key={v.id} className={v.id === a.mainView ? "main" : ""}>
            <div className="thumb">
              {v.thumbUrl && <img src={v.thumbUrl} alt={`camera view ${v.id + 1}`} />}
              {v.id === a.mainView && a.team && a.team.path.length > 1 && (
                // where the team's robot drove in auto (bottom-centre of its box)
                <svg viewBox="0 0 1280 720" preserveAspectRatio="none" aria-label="team robot auto path">
                  {autoSegments(a.team.path).map((seg, i) => <polyline key={i} points={seg.map(p => `${p.x},${p.y}`).join(" ")} className="path-auto" />)}
                </svg>
              )}
            </div>
            <figcaption>
              {v.id === a.mainView ? "Main view · " : ""}{v.seconds.toFixed(0)} s · {v.shots} shot{v.shots === 1 ? "" : "s"}
              {!v.live && " · replay / not live"}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="muted small">
        {a.team ? "Yellow = the robot's path in autonomous (first 30 s). " : ""}
        Transition ({TRANSITION_S} s) is not counted as play time.
      </p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><b>{value}</b></div>;
}

const pct = (x: number) => `${Math.round(Math.min(1, x) * 100)}%`;
