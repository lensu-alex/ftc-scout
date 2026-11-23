// End-to-end: a team's matches at one event, located and analysed from the real stream.
// usage: tsx scripts/eval-run.ts <team> <eventCode> <youtubeId> [lastN]
import { teamMatches } from "../src/api/ftcscout";
import { runStream } from "../src/analysis/run";
import { fmt } from "../src/analysis/locate";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { frameToPng } from "./load";
import { NodeSource } from "../helper/source";
import { resolveStream } from "../helper/youtube";

const [team, event, id, n] = process.argv.slice(2);
const { matches } = await teamMatches(+team);
const sel = matches.filter(m => m.eventCode === event && m.played).slice(-(+(n ?? 3)));
const { url, duration } = await resolveStream(id);
const src = new NodeSource(url, duration);
const t0 = Date.now();
await runStream(src, sel, (k, s) => {
  if (s.state === "done") {
    const a = s.analysis;
    console.log(`${k}: start ${fmt(a.start)} | views ${a.views.length} cuts ${a.shots.length - 1} | main ${(a.mainCoverage * 100).toFixed(0)}% | auto ${a.phaseTimes.auto.toFixed(0)}s teleop ${a.phaseTimes.teleop.toFixed(0)}s | clock ok ${a.clockChecks.filter(c => c.read !== null && Math.abs(c.read - c.expected) <= 2).length}/${a.clockChecks.length}`);
  } else if (s.state !== "analysing") console.log(k, s.state);
}, () => {}, new AbortController().signal, () => new TinyOverlayReader(),
  (s, from, to) => (s as NodeSource).frames(from, to - from, 3));
console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s for ${sel.length} matches`);
process.exit(0);
