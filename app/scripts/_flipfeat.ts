// dev: features of each see-saw flip, labelled by whether its hive's count matches the official one
import { readFileSync, existsSync } from "node:fs";
import { seesawFlips, type HiveSample } from "../src/vision/hive";
const [truthFile, dir] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthFile, "utf8"));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
for (const name of Object.keys(truth)) {
  const f = `${dir}/${name}.json`; if (!existsSync(f)) continue;
  const c = JSON.parse(readFileSync(f, "utf8"));
  for (const r of c.hiveSamples.filter((r: any) => r.view === c.mainView)) {
    const S: HiveSample[] = r.samples, w = truth[name][r.hive], n = w.auto + w.dc;
    const v = seesawFlips(S);
    const lab = n === 0 ? "FALSE" : v.flips.length === n ? "true " : "?    ";
    v.runs.slice(1).forEach((b, k) => {
      const a = v.runs[k];
      const before = med(S.filter(s => s.t >= a.t1 - 3 && s.t <= a.t1 && !s.hidden).map(s => s.area)) / r.ballArea;
      const after = med(S.filter(s => s.t >= b.t0 && s.t <= b.t0 + 3 && !s.hidden).map(s => s.area)) / r.ballArea;
      const win = S.filter(s => s.t >= a.t1 - 3 && s.t <= b.t0 + 1 && !s.hidden);
      const peak = Math.max(0, ...win.map((_, i) => med(win.slice(Math.max(0, i - 5), i + 6).map(s => s.area)))) / r.ballArea;
      const discB = med(S.filter(s => s.t >= a.t1 - 3 && s.t <= a.t1).map(s => s.discs ?? 0));
      const hid = S.filter(s => s.t >= a.t1 - 2 && s.t <= b.t0 + 2 && s.hidden).length;
      console.log(`${lab} ${(name + " " + r.hive).padEnd(14)} ${r.mode.padEnd(5)} t${((a.t1 + b.t0) / 2).toFixed(0).padStart(4)} gap ${(b.t0 - a.t1).toFixed(1).padStart(4)} runA ${(a.t1 - a.t0).toFixed(0).padStart(3)} runB ${(b.t1 - b.t0).toFixed(0).padStart(3)} balls ${before.toFixed(1).padStart(4)} → ${after.toFixed(1).padStart(4)} peak ${peak.toFixed(1).padStart(4)} discs ${discB} hid ${hid}`);
    });
  }
}
