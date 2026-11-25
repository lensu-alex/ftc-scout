// Volleys at the hive vs the owner's hand-marked launches of 12808 in Oregon Q1 (tools/dataset/launches/USORSFM1-1.json:
// 15 volleys, 56 balls launched; the cache must be or1). Marks are launches, so scored balls <= marked per volley.
// Also prints, for every cached match, volleys / balls per hive with the old reading (area only) and the new one
// (see-saw positions). usage: tsx scripts/eval-volleys.ts <cacheDir> [marks.json]
import { readFileSync, existsSync } from "node:fs";
import { hiveEvents, hiveTimeline, type HiveEvent, type HiveSample } from "../src/vision/hive";
const [dir, marksFile = "../tools/dataset/launches/USORSFM1-1.json"] = process.argv.slice(2);
type Raw = { view: number; hive: "red" | "blue"; ballArea: number; mode: "area" | "discs"; samples: HiveSample[] };
const load = (n: string) => { const c = JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8")); return (c.hiveSamples as Raw[]).filter(r => r.view === c.mainView); };
const PER = !!process.env.PER;
const read = (r: Raw, how: "old" | "new"): HiveEvent[] => (how === "old" ? hiveEvents(r.samples, r.ballArea, 0.6, r.mode).events : hiveTimeline(r.samples, r.ballArea, r.mode, { perPosition: PER }).events);
const names = ["or1", "or5", "or9", "or18", "q10", "m1", "nlron", "micoq", "micoq21", "alatq4", "iadaim10"].filter(n => existsSync(`${dir}/${n}.json`));
for (const n of names) {
  const row = load(n).map(r => {
    const o = read(r, "old").filter(e => e.kind === "scored"), w = read(r, "new").filter(e => e.kind === "scored");
    const b = (es: HiveEvent[]) => es.reduce((s, e) => s + (e.balls ?? 0), 0);
    return `${r.hive} volleys ${o.length} → ${w.length}, balls ${b(o)} → ${b(w)}`;
  });
  console.log(`${n.padEnd(9)} ${row.join(" | ")}`);
}
if (existsSync(`${dir}/or1.json`) && existsSync(marksFile)) {
  const marks: { t: number; who: string; volley?: number }[] = JSON.parse(readFileSync(marksFile, "utf8"));
  const vols = [...new Map(marks.filter(m => m.who === "team").map(m => [m.t, marks.filter(x => x.t === m.t && x.who === "team").length])).entries()];
  const blue = load("or1").find(r => r.hive === "blue")!;
  for (const how of ["old", "new"] as const) {
    const ev = read(blue, how).filter(e => e.kind === "scored");
    let hit = 0, over = 0, under = 0, exact = 0; const used = new Set<HiveEvent>(); const per: string[] = [];
    for (const [t, k] of vols) {
      const e = ev.find(e => !used.has(e) && (e.riseAt ?? e.t) >= t - 0.5 && (e.riseAt ?? e.t) <= t + 2.5);
      if (!e) { per.push(`${t.toFixed(0)}:${k}/-`); continue; }
      used.add(e); hit++; const b = e.balls ?? 0; if (b > k) over++; else if (b < k) under++; else exact++;
      per.push(`${t.toFixed(0)}:${k}/${b}`);
    }
    console.log(`or1 blue 12808 (${how}): ${hit}/${vols.length} marked volleys found; balls exact ${exact}, fewer ${under}, more ${over} (more = impossible) | ${per.join(" ")}`);
  }
}
