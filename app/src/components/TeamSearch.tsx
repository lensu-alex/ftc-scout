import { useEffect, useRef, useState } from "react";
import { searchTeams, type TeamSummary } from "../api/ftcscout";

export function TeamSearch({ onPick }: { onPick: (n: number) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TeamSummary[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = window.setTimeout(() => {
      searchTeams(q.trim()).then(setResults).catch(() => setResults([]));
    }, 250);
  }, [q]);

  const choose = (n: number) => { setOpen(false); setQ(""); onPick(n); };

  return (
    <div className="search" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <input
        value={q} placeholder="Search team name or number" aria-label="Search teams"
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "Enter") {
            const n = Number(q.trim());
            if (Number.isInteger(n) && n > 0) choose(n);
            else if (results[0]) choose(results[0].number);
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="results">
          {results.map(t => (
            <li key={t.number}>
              <button onMouseDown={() => choose(t.number)}>
                <b>{t.number}</b> {t.name}
                <span className="muted">{[t.city, t.country].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
