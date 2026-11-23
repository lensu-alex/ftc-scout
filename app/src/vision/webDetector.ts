// Runs the detector model in the browser with ONNX Runtime Web (WebGPU when available, else WASM).
import type { Infer } from "./detector";

let session: Promise<import("onnxruntime-web").InferenceSession> | null = null;
let ortMod: typeof import("onnxruntime-web") | null = null;

export const webInfer: Infer = async (input, size) => {
  session ??= (async () => {
    ortMod = await import("onnxruntime-web"); // loaded only when video analysis starts
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    return ortMod.InferenceSession.create("/models/ftc-det.onnx", { executionProviders: providers });
  })();
  const s = await session;
  const out = await s.run({ [s.inputNames[0]]: new ortMod!.Tensor("float32", input, [1, 3, size, size]) });
  const t = out[s.outputNames[0]];
  return { data: t.data as Float32Array, dims: t.dims };
};
