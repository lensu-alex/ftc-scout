// dev: timeline of one hive (2 s steps): yellow area, tube pixels, see-saw distance from the first 2 s. usage: tsx scripts/_kinds.ts <cache.json> red|blue
import { readFileSync } from "node:fs";
const [file, hive] = process.argv.slice(2);
const c = JSON.parse(readFileSync(file, "utf8"));
const r = c.hiveSamples.find((r: any) => r.view === c.mainView && r.hive === hive);
const S = r.samples.filter((s: any) => s.shape && s.look && !s.hidden);
// print per 2 s: area, mean shape fraction, mean look, 1st principal-ish: diff from first second
const zs = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) + 1e-6; return v.map(x => (x - m) / sd); };
const ref = (k: string) => { const f = S.filter((s: any) => s.t < S[0].t + 2).map((s: any) => k === "shape" ? s.shape : zs(s.look)); return f[0].map((_: any, d: number) => f.reduce((a: number, v: number[]) => a + v[d], 0) / f.length); };
const rs = ref("shape"), rl = ref("look");
const d = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
let line = "";
for (let t = Math.ceil(S[0].t); t < S[S.length - 1].t; t += 2) {
  const w = S.filter((s: any) => s.t >= t && s.t < t + 2); if (!w.length) continue;
  const ds = w.map((s: any) => d(s.shape, rs)).sort((a: number, b: number) => a - b)[w.length >> 1];
  const dl = w.map((s: any) => d(zs(s.look), rl)).sort((a: number, b: number) => a - b)[w.length >> 1];
  const ar = w.map((s: any) => s.area).sort((a: number, b: number) => a - b)[w.length >> 1];
  const tube = w.map((s: any) => s.shape.reduce((a: number, b: number) => a + b, 0)).sort((a: number, b: number) => a - b)[w.length >> 1];
  console.log(`${String(t).padStart(3)} area ${String(ar).padStart(5)} tube ${tube.toFixed(1).padStart(5)} dShape ${ds.toFixed(2).padStart(5)} dLook ${dl.toFixed(1).padStart(5)} n${w.length}`);
}
