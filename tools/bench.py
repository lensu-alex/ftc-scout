"""Dev: compare trained configurations on the held-out events: accuracy per class + CPU speed of the ONNX model."""
import sys, time, glob, os, numpy as np, onnxruntime as ort
from ultralytics import YOLO
for name in sys.argv[1:]:
    w = f"runs/{name}/weights/best.pt"
    if not os.path.exists(w): print(name, "missing"); continue
    m = YOLO(w); imgsz = m.ckpt["train_args"]["imgsz"]
    r = m.val(data=os.environ.get("FTC_DATA", "dataset/yolo") + "/data.yaml", imgsz=imgsz, device="mps", verbose=False, plots=False)
    per = {n: r.class_result(i) for i, n in r.names.items()}
    onnx = m.export(format="onnx", imgsz=imgsz, opset=17, simplify=True, verbose=False)
    s = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"], sess_options=(lambda o: (setattr(o, "intra_op_num_threads", 2), o)[1])(ort.SessionOptions()))
    x = np.random.rand(1, 3, imgsz, imgsz).astype(np.float32)
    for _ in range(3): s.run(None, {s.get_inputs()[0].name: x})
    t = time.time(); [s.run(None, {s.get_inputs()[0].name: x}) for _ in range(20)]; ms = (time.time() - t) / 20 * 1000
    print(f"{name:14s} {imgsz:4d}px mAP50 {r.box.map50:.3f} mAP50-95 {r.box.map:.3f} | " +
          " ".join(f"{n[:6]} R{v[1]:.2f}/P{v[0]:.2f}" for n, v in per.items()) +
          f" | {ms:.0f} ms/frame (2 CPU threads) | {os.path.getsize(onnx)/1e6:.1f} MB")
