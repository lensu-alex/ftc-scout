"""Experiment: balls resting in a hive cell. Per frame, in a window around each hive cell, count
clearly yellow pixels and yellow blobs at native resolution. Steps up = balls scored.
usage: .venv/bin/python cell_count.py <clip> <start> <out.json> <name:x0,y0,x1,y1> [...]"""
import sys, json, subprocess, numpy as np
from scipy import ndimage
clip, start, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
wins = {}
for w in sys.argv[4:]:
    name, box = w.split(":"); wins[name] = [int(v) for v in box.split(",")]
W, H, FPS, DUR = 1280, 720, 30, 160
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", str(DUR), "-vf", f"fps={FPS},scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
log = {k: [] for k in wins}
n = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    for k, (x0, y0, x1, y1) in wins.items():
        c = a[y0:y1, x0:x1].astype(np.int16)
        r, g, b = c[..., 0], c[..., 1], c[..., 2]
        yel = (r > 150) & (g > 150) & (b < 0.65 * g) & (r >= 0.85 * g)
        lab, m = ndimage.label(yel)
        blobs = []
        if m:
            idx = np.arange(1, m + 1); areas = ndimage.sum(yel, lab, idx)
            keep = areas >= 12
            if keep.any():
                cs = ndimage.center_of_mass(yel, lab, idx[keep])
                blobs = [[round(float(cx) + x0, 1), round(float(cy) + y0, 1), int(ar)] for (cy, cx), ar in zip(cs, areas[keep])]
        log[k].append([int(yel.sum()), blobs])
    n += 1
p.wait()
json.dump({"fps": FPS, "windows": wins, "log": log}, open(out, "w"))
print(f"{n} frames → {out}", file=sys.stderr)
