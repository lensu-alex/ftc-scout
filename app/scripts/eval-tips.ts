// Hive tips detected vs the official count (FTCScout match results: autoHiveTips / dcHiveTips per alliance).
// Official scores are used here only to MEASURE the vision, never by the app.
// Input: caches from scripts/cache-pass1.ts (they carry the raw hive samples) + a truth file:
//   { "<name>": { "red": { "auto": n, "dc": n, "end": n }, "blue": {...} }, ... }
// usage: tsx scripts/eval-tips.ts <truth.json> <cacheDir> [name,...]   env: VERBOSE=1 prints event times
import { readFileSync, existsSync } from "node:fs";
import { hiveEvents, seesawFlips, type HiveSample } from "../src/vision/hive";

type Raw = { view: number; hive: "red" | "blue"; ballArea: number; mode: "area" | "discs"; samples: HiveSample[] };
const [truthFile, dir, only] = process.argv.slice(2);
const truth: Record<string, Record<"red" | "blue", { auto: number; dc: number; end: number }>> = JSON.parse(readFileSync(truthFile, "utf8"));
const AUTO_END = 30 + 4;   // auto is 0:30, then 8 s of transition: a tip seen up to ~4 s later still came from auto

let tot = { truth: 0, found: 0, absErr: 0, autoErr: 0, sFound: 0, sErr: 0, sAutoErr: 0 };
for (const name of Object.keys(truth)) {
  if (only && !only.split(",").includes(name)) continue;
  const f = `${dir}/${name}.json`;
  if (!existsSync(f)) continue;
  const c = JSON.parse(readFileSync(f, "utf8"));
  const raw: Raw[] = (c.hiveSamples ?? []).filter((r: Raw) => r.view === c.mainView);
  const row: string[] = [];
  for (const h of ["red", "blue"] as const) {
    const r = raw.find(x => x.hive === h), want = truth[name][h];
    if (!r) { row.push(`${h} -`); continue; }
    const ev = hiveEvents(r.samples, r.ballArea, 0.6, r.mode).events;
    const tips = ev.filter(e => e.kind === "tip"), auto = tips.filter(e => e.t <= AUTO_END).length;
    const n = want.auto + want.dc;
    tot.truth += n; tot.found += tips.length; tot.absErr += Math.abs(tips.length - n); tot.autoErr += Math.abs(auto - want.auto);
    const balls = ev.filter(e => e.kind === "scored").reduce((s, e) => s + (e.balls ?? 0), 0);
    const sf = seesawFlips(r.samples, r.mode === "area" ? { ballArea: r.ballArea, minBalls: 2 } : {}), sAuto = sf.flips.filter(t => t <= AUTO_END).length;
    tot.sFound += sf.flips.length; tot.sErr += Math.abs(sf.flips.length - n); tot.sAutoErr += Math.abs(sAuto - want.auto);
    row.push(`${h} official ${n} (auto ${want.auto}) | area ${tips.length} (${auto}) | see-saw ${sf.flips.length} (${sAuto}) ${sf.kind} d'${sf.sep.toFixed(1)}`.padEnd(70));
    if (process.env.VERBOSE) console.log(`  ${name} ${h} [${r.mode}, ball ${Math.round(r.ballArea)} px]: ` + ev.map(e => `${e.kind === "tip" ? "TIP" : "+" + e.balls}@${e.t.toFixed(1)}`).join(" "));
  }
  console.log(`${name.padEnd(9)} ${row.join(" | ")}`);
}
console.log(`official ${tot.truth} tips | area: found ${tot.found}, |error| ${tot.absErr}, auto |error| ${tot.autoErr} | see-saw: found ${tot.sFound}, |error| ${tot.sErr}, auto |error| ${tot.sAutoErr}`);
