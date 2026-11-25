// dev: balls in the cell just before each tip (last plateau level / that position's ball area). If a cell tips at a
// roughly fixed load, a better ball calibration gives a tighter spread. usage: tsx scripts/_pretip.ts <cacheDir>
import { readFileSync, existsSync } from "node:fs";
import { hiveTimeline } from "../src/vision/hive";
const dir = process.argv[2];
for (const per of [false, true]) {
  const all: number[] = [], rows: string[] = [];
  for (const n of ["or1", "or5", "or9", "or18", "q10", "m1"]) {
    if (!existsSync(`${dir}/${n}.json`)) continue;
    const c = JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
    for (const r of c.hiveSamples.filter((r: any) => r.view === c.mainView && r.mode === "area")) {
      const tl = hiveTimeline(r.samples, r.ballArea, r.mode, { perPosition: per });
      if (!tl.seesaw) continue;
      const v = tl.seesaw.flips.map(t => { const run = tl.seesaw!.runs.filter(x => x.t1 <= t).pop(); const p = tl.plateaus.filter(p => p.t1 <= t).pop(); return run && p ? p.level / tl.ballAreas[run.pos] : NaN; }).filter(x => !isNaN(x) && x > 0.5);
      all.push(...v); rows.push(`${n} ${r.hive}: ${v.map(x => x.toFixed(1)).join(" ")}`);
    }
  }
  const m = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / all.length);
  console.log(`perPosition ${per}: ${all.length} tips, balls before a tip mean ${m.toFixed(1)} sd ${sd.toFixed(2)} cv ${(sd / m).toFixed(2)}`);
  if (process.env.VERBOSE) console.log("  " + rows.join("\n  "));
}
