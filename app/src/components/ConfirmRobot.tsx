import { useState } from "react";
import type { TeamMatch } from "../api/ftcscout";
import { confirmRobot, type HelperMatchStatus } from "../api/helper";

// The user points at the team's robot in each match (a second per match, and always right). The
// app's guess is pre-highlighted; every answer also sharpens the guesses for the other matches.

export function ConfirmRobot({ team, matches, status, jobOf }: {
  team: number; matches: TeamMatch[]; status: Record<string, HelperMatchStatus>; jobOf: Record<string, string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // a match where taps add more pictures of the robot
  const [done, setDone] = useState<string | null>(null); // last saved answer, shown as a confirmation
  const rows = matches.flatMap(m => {
    const s = status[m.key];
    if (s?.state !== "done" || !s.report.candidates?.length || !jobOf[m.key]) return [];
    return [{
      m, cands: s.report.candidates, confirmed: !!s.report.confirmed, skipped: !!s.report.confirmed && !s.report.team,
      followed: s.report.team?.stats?.trackedPct ?? null, auto: (s.report.team?.path ?? []).filter(p => p.t >= 0 && p.t < 30).length,
    }];
  });
  if (rows.length === 0) return null;
  const open = (r: (typeof rows)[number]) => !r.confirmed || editing === r.m.key || adding === r.m.key;
  const todo = rows.filter(open), answered = rows.filter(r => !open(r));

  const answer = async (m: TeamMatch, trackId: number) => {
    const add = adding === m.key && trackId !== -1;
    setBusy(m.key); setError(null); setDone(null);
    try {
      await confirmRobot(jobOf[m.key], m.key, trackId, add);
      setDone(`✓ ${m.description}: ${trackId === -1 ? "left out of the stats" : add ? "picture added" : "robot set"}. Stats updated.`);
      if (!add) setEditing(null);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const row = ({ m, cands, confirmed, skipped }: (typeof rows)[number]) => (
    <div key={m.key} className="confirm-row">
      <div className="confirm-match">
        <b>{m.description}</b> <span className={`pill ${m.alliance.toLowerCase()}`}>{m.alliance}</span>
        {adding === m.key && <div className="small">Tap every other picture of {team} (highlighted = already used).{" "}
          <button className="small-btn" onClick={() => setAdding(null)}>Done</button></div>}
        {confirmed && <div className="muted small">{skipped ? "left out" : "your answer"}</div>}
      </div>
      <div className="confirm-cands">
        {cands.map(c => (
          <button key={c.trackId} className={`cand ${c.picked ? "picked" : ""}`} disabled={busy !== null}
            onClick={() => answer(m, c.trackId)} aria-label={`robot ${c.trackId}${c.picked ? " (current pick)" : ""}`}>
            {c.thumbUrl ? <img src={c.thumbUrl} alt="" /> : <span className="muted">no picture</span>}
          </button>
        ))}
        <button className={`cand none ${skipped ? "picked" : ""}`} disabled={busy !== null} onClick={() => answer(m, -1)}>
          Not shown /<br />can't tell
        </button>
      </div>
    </div>
  );

  // an answered match in one line: the chosen picture, how much of the match it's followed
  const summary = ({ m, cands, skipped, followed, auto }: (typeof rows)[number]) => {
    const pick = cands.find(c => c.picked);
    return (
      <div key={m.key} className="confirm-done">
        <b>{m.description}</b> <span className={`pill ${m.alliance.toLowerCase()}`}>{m.alliance}</span>
        {skipped ? <span className="muted">left out</span> : <>
          {pick?.thumbUrl && <img src={pick.thumbUrl} alt={`your choice for ${m.description}`} />}
          <span className={followed !== null && followed < 0.4 ? "warn" : "muted"}>
            followed {followed === null ? "—" : `${Math.round(followed * 100)}%`} of the match{auto < 3 ? " · no auto path" : ""}
          </span>
        </>}
        {!skipped && <button className="small-btn" disabled={busy !== null} onClick={() => setAdding(m.key)}>+ Add another picture of {team}</button>}
        <button className="small-btn" disabled={busy !== null} onClick={() => setEditing(m.key)}>Change</button>
      </div>
    );
  };

  return (
    <section className="card">
      <h2>{todo.length ? `Tap ${team} in each match` : `${team} confirmed in every match`}</h2>
      {todo.length > 0 && <p className="muted small">
        {todo.length} match{todo.length === 1 ? "" : "es"} to go. The highlighted picture is the app's guess; tap the
        right robot (or the guess, if it's right). If {team} isn't among them, press "Not shown" and that match is left
        out. Each answer also improves the guesses for the rest.
      </p>}
      {error && <p className="warn">{error}</p>}
      {busy && <p className="muted small">Updating {matches.find(m => m.key === busy)?.description}…</p>}
      {done && !busy && <p className="ok small">{done}</p>}
      {todo.map(row)}
      {answered.length > 0 && <>
        <p className="muted small" style={{ marginBottom: 4 }}>
          Your answers. A low % means the app lost {team} often and split it into pieces: add the other pictures of it.
        </p>
        {answered.map(summary)}
      </>}
    </section>
  );
}
