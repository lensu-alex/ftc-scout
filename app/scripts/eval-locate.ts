// End-to-end locator test on a real stream: anchor, then find the given team's matches.
// usage: tsx scripts/eval-locate.ts <youtubeId> <eventCode> [team]
import { eventMatches, overlayKey } from "../src/api/ftcscout";
import { Locator, fmt } from "../src/analysis/locate";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { frameToPng } from "./load";
import { NodeSource } from "../helper/source";
import { resolveStream } from "../helper/youtube";

const [id, event, team, explicit] = process.argv.slice(2);
const { url, duration } = await resolveStream(id);
const all = await eventMatches(event);
const api = all.filter(m => m.actualStartTime).map(m => ({ key: overlayKey(m.tournamentLevel, m.matchNum, m.series), start: Date.parse(m.actualStartTime!) / 1000 }));
const reader = new TinyOverlayReader();
await reader.init();
const loc = new Locator(new NodeSource(url, duration), reader, api, m => console.log("  ", m));
const keys = explicit ? Promise.resolve(explicit.split(",")) : team && team !== "-" ? (await import("../src/api/ftcscout")).teamMatches(+team).then(r => r.matches.filter(m => m.eventCode === event).map(m => overlayKey(m.level, m.matchNum, m.series))) : Promise.resolve(api.filter(m => m.key.startsWith("Q")).map(m => m.key).filter((_, i) => i % 4 === 0));
for (const k of await keys) {
  const before = loc.probes;
  const r = await loc.locate(k);
  console.log(k, r ? `${fmt(r.start)} (${r.confidence})` : "NOT FOUND", `${loc.probes - before} seeks`);
}
await reader.close();
