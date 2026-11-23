import { readFileSync } from "node:fs";
import { leftStart, dwells, cycles, endgame, autoDistance, stops } from "../src/analysis/robotStats";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const paths: Record<string, any[]> = {};
for (const [k, st] of Object.entries<any>(j.status)) {
  const t = st.report?.team; if (!t) continue;
  paths[k] = t.path;
  const c = cycles(t.path), e = endgame(t.path);
  console.log(k, "followed", Math.round(t.stats.trackedPct * 100) + "%", "| leave", leftStart(t.path), "| dwells", dwells(t.path).length,
    "| cycles", c.count, c.spot ? `@(${Math.round(c.spot.x)},${Math.round(c.spot.y)})` : "", "| end", e ? (e.parked ? "parked" : "moving") + `@(${Math.round(e.at.x)},${Math.round(e.at.y)})` : "?",
    "| stops", stops(t.path).length);
}
const ks = Object.keys(paths);
for (let i = 0; i < ks.length; i++) for (let k = i + 1; k < ks.length; k++) {
  const d = autoDistance(paths[ks[i]], paths[ks[k]]); if (d !== null) console.log(`auto ${ks[i]} vs ${ks[k]}: ${d.toFixed(1)} robot lengths`);
}
