// dev: Q-18 through the helper's own frame source (YouTube, 8 parallel MJPEG parts) → track list
import { resolveStream } from "../helper/youtube";
import { NodeSource } from "../helper/source";
import { analyzeMatch } from "../src/analysis/analyzeMatch";
import { TinyOverlayReader } from "../src/vision/tinyOcr";
import { nodeInfer, nodeEmbed, detectorSize } from "../helper/detector";
const s = await resolveStream("ww7WnVRRIfg");
const src = new NodeSource(s.url, s.duration);
const start = 9144.2;
let last = -1, back = 0, n = 0;
async function* frames() {
  for await (const f of src.frames(start - 3, 165, 10)) { n++; if (f.t < last) back++; last = f.t; yield f; }
}
const a = await analyzeMatch(frames(), start, new TinyOverlayReader(), { infer: nodeInfer, embedInfer: nodeEmbed, detectSize: detectorSize() });
console.log(`frames ${n}, out-of-order ${back}, views ${a.views.length}, cuts ${a.shots.length - 1}, tracks ${a.robots.length}`);
console.log(a.robots.map(r => `#${r.id}:${(r.path[0].t - a.start).toFixed(0)}-${(r.path[r.path.length - 1].t - a.start).toFixed(0)}s v${r.view}`).join(" "));
