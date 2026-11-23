// Sends a team's last N matches at one event to the running helper and follows the job.
// usage: tsx scripts/helper-job.ts <team> <youtubeId> [n]
import { teamMatches } from "../src/api/ftcscout";
const [team, vid, n = "2"] = process.argv.slice(2);
const { matches } = await teamMatches(+team);
const sel = matches.filter(m => m.played).slice(-(+n));
const r = await fetch("http://127.0.0.1:47615/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: vid, matches: sel }) });
const { id } = await r.json();
const t0 = Date.now();
let last = "";
for (;;) {
  await new Promise(r => setTimeout(r, 3000));
  const j = await (await fetch(`http://127.0.0.1:47615/jobs/${id}`)).json();
  const s = Object.entries(j.status).map(([k, v]: [string, any]) => `${k}:${v.state}${v.report ? ` @${Math.round(v.report.start)}s views ${v.report.views.length} main ${Math.round(v.report.mainCoverage * 100)}%` : ""}`).join(" | ");
  if (s !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${j.state} ${s}`); last = s; }
  if (["done", "error", "cancelled"].includes(j.state)) { console.log(j.error ?? "", j.log.filter((l: string) => !l.startsWith("look")).join("\n")); break; }
}
