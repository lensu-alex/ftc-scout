// Pull frames for detector labelling: from matches the locator already found (tools/debug/locate/*.txt),
// a few moments per match (auto, early/mid/late teleop) → tools/dataset/train_raw/<stream>_<match>_<s>.jpg
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { NodeSource } from "../helper/source";
import { resolveStream } from "../helper/youtube";
import { frameToPng } from "./load";

const out = new URL("../../tools/dataset/train_raw/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const streams = Object.fromEntries(["streams.txt", "streams_more.txt"].flatMap(f => readFileSync(`../tools/${f}`, "utf8").trim().split("\n")).map(l => l.split(" ")));
const only = process.argv[2];
for (const f of readdirSync("../tools/debug/locate")) {
  const name = f.replace(".txt", "");
  if (only && name !== only) continue;
  const found = [...readFileSync(`../tools/debug/locate/${f}`, "utf8").matchAll(/^(Q\d+) ([\d:]+) \(/gm)]
    .map(m => ({ key: m[1], start: m[2].split(":").reduce((a, x) => a * 60 + +x, 0) }));
  if (!found.length || !streams[name]) continue;
  const id = new URL(streams[name]).searchParams.get("v") ?? streams[name].split("/").pop()!;
  const { url, duration } = await resolveStream(id);
  const src = new NodeSource(url, duration);
  // up to 5 matches spread over the event, 10 moments each (auto, teleop, endgame)
  const pick = [0, 0.25, 0.5, 0.75, 1].map(f => found[Math.round(f * (found.length - 1))]).filter((m, i, a) => m && a.indexOf(m) === i);
  for (const m of pick) {
    for (const e of [5, 12, 20, 30, 45, 60, 80, 100, 125, 150]) {
      const p = `${out}${name}_${m.key}_${e}.jpg`;
      if (existsSync(p)) continue;
      await src.seek(m.start + e);
      const fr = await src.grab();
      if (fr) await frameToPng(fr).jpeg({ quality: 92 }).toFile(p);
    }
  }
  console.log(name, "ok");
}
