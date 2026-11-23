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
        {a.scoring && <Fact label={`${match.alliance} alliance pollen`} value={`${a.scoring.hive[match.alliance.toLowerCase() as "red" | "blue"].balls} in ${a.scoring.hive[match.alliance.toLowerCase() as "red" | "blue"].volleys} volleys, ${a.scoring.hive[match.alliance.toLowerCase() as "red" | "blue"].tips} tips`} />}
        {a.scoring?.team && <Fact label="Team pollen scored" value={a.scoring.team.unsure ? `${a.scoring.team.sure}–${a.scoring.team.sure + a.scoring.team.unsure}` : String(a.scoring.team.sure)} />}
        {a.scoring?.partner && <Fact label="Partner pollen scored" value={a.scoring.partner.unsure ? `${a.scoring.partner.sure}–${a.scoring.partner.sure + a.scoring.partner.unsure}` : String(a.scoring.partner.sure)} />}
        {a.team !== undefined && (
          <Fact label="Team robot" value={a.confirmed ? (a.team ? "your choice" : "left out by you") : !a.team ? "not found" : `app's guess (${pct(a.team.confidence)})`} />
        )}
      </div>
      {a.scoring && a.scoring.volleys.length > 0 && (
        <div className="volleys">
          <h4>Pollen at the hive</h4>
          <div className="volley-row">
            {a.scoring.volleys.map((v, i) => {
              const cls = v.who === "team" ? (v.sure ? "team" : "team unsure") : v.who === "partner" ? (v.sure ? "partner" : "partner unsure") : v.who === "other" ? "other" : "unknown";
              const label = v.who === "team" ? "your team" : v.who === "partner" ? "partner" : v.who === "other" ? "other alliance" : "unsure who";
              const m = Math.floor(v.t / 60), sec = Math.round(v.t % 60);
              return <span key={i} className={`volley ${cls}`} title={`${m}:${String(sec).padStart(2, "0")} · ${v.balls} ball${v.balls === 1 ? "" : "s"} · ${label}${v.sure === false ? " (unsure)" : ""}`}>{v.balls}</span>;
            })}
          </div>
          <div className="muted small">Each box is one volley (number = balls scored). Green = your team, blue = partner, grey = other alliance, dashed = unsure.</div>
        </div>
      )}
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
