import { readFileSync, writeFileSync } from "node:fs";
import { dwells, cycles } from "../src/analysis/robotStats";
const j = JSON.parse(readFileSync(process.argv[2], "utf8")), k = process.argv[3];
const t = j.status[k].report.team, c = cycles(t.path);
const close = (d: any) => Math.hypot(d.x - c.spot!.x, d.y - c.spot!.y) <= 1.2 * Math.max(d.s, c.spot!.s);
const ds = dwells(t.path).map(d => ({ ...d, main: close(d) }));
writeFileSync("../tools/debug/cyc.json", JSON.stringify({ start: j.status[k].report.start, spot: c.spot, dwells: ds }));
console.log(ds.map(d => `${d.main ? "*" : ""}${d.from.toFixed(0)}-${d.to.toFixed(0)}s`).join(" "));
