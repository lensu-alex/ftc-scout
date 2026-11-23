import { useState } from "react";
import { TeamSearch } from "./components/TeamSearch";
import { TeamView } from "./components/TeamView";

export default function App() {
  const [team, setTeam] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(location.search).get("team"));
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  const pick = (n: number | null) => {
    setTeam(n);
    const u = new URL(location.href);
    if (n) u.searchParams.set("team", String(n)); else u.searchParams.delete("team");
    history.replaceState(null, "", u);
  };

  return (
    <div className="page">
      <header className="top">
        <button className="brand" onClick={() => pick(null)}>FTC Scout <span>BIOBUZZ</span></button>
        <TeamSearch onPick={pick} />
      </header>
      <main>
        {team ? <TeamView key={team} number={team} /> : <Intro />}
      </main>
    </div>
  );
}

function Intro() {
  return (
    <section className="intro">
      <h1>Scout any FTC team from the match video</h1>
      <p>
        Search a team, pick how many recent matches to check, and the analysis runs on <b>this device</b>: it finds
        each match in the event stream, follows the match clock and the camera, and (next) tracks the robot.
      </p>
      <p className="muted">Official scores are shown for reference only and are never used for the analysis.</p>
    </section>
  );
}
