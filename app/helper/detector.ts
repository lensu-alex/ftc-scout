// Runs the detector model in the helper with ONNX Runtime for Node.
import * as ort from "onnxruntime-node";
import { existsSync, readFileSync } from "node:fs";
import type { Infer } from "../src/vision/detector";

const MODEL = process.env.FTC_DET ?? new URL("../public/models/ftc-det.onnx", import.meta.url).pathname;
let session: Promise<ort.InferenceSession> | null = null;

export const detectorAvailable = () => existsSync(MODEL);
/** The model's input size, from the file next to it (ftc-det.json: {"size": 832}); 640 if none. */
export function detectorSize(): number {
  try { return JSON.parse(readFileSync(MODEL.replace(/\.onnx$/, ".json"), "utf8")).size ?? 640; } catch { return 640; }
}

export const nodeInfer: Infer = async (input, size) => {
  session ??= ort.InferenceSession.create(MODEL, { intraOpNumThreads: 2 }); // light: leave cores free
  const s = await session;
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const t = out[s.outputNames[0]];
  return { data: t.data as Float32Array, dims: t.dims };
};

const EMBED = new URL("../public/models/ftc-embed.onnx", import.meta.url).pathname;
let embedSession: Promise<ort.InferenceSession> | null = null;

export const embedderAvailable = () => existsSync(EMBED);

export const nodeEmbed = async (input: Float32Array, size: number): Promise<Float32Array> => {
  embedSession ??= ort.InferenceSession.create(EMBED, { intraOpNumThreads: 2 });
  const s = await embedSession;
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  return out[s.outputNames[0]].data as Float32Array;
};
