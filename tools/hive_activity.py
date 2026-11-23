"""Experiment: what arrives at the hive. At 30 fps, native resolution, inside a window around each
hive's upward cell, pixels that differ from a slow background are blobs; per frame we log the blobs.
usage: .venv/bin/python hive_activity.py <clip> <start> <out.json> <name:x0,y0,x1,y1> [...]"""
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
bg = {k: None for k in wins}
log = {k: [] for k in wins}
n = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    for k, (x0, y0, x1, y1) in wins.items():
        c = a[y0:y1, x0:x1].astype(np.float32)
        if bg[k] is None: bg[k] = c.copy()
        d = np.abs(c - bg[k]).sum(-1)
        ch = d > 90
        # the background follows everything within ~5 frames: only fast movers (balls in flight) show up;
        # a ball resting in the cell or the hive tipping over fades in quickly
        bg[k] += 0.25 * (c - bg[k])
        lab, m = ndimage.label(ch)
        fr = []
        if m:
            idx = np.arange(1, m + 1)
            areas = ndimage.sum(ch, lab, idx)
            keep = (areas >= 5) & (areas <= 400)
            if keep.any():
                cs = ndimage.center_of_mass(ch, lab, idx[keep])
                cols = [c[lab == i].mean(0) for i in idx[keep]]
                for (cy, cx), ar, col in zip(cs, areas[keep], cols):
                    fr.append([round(float(cx) + x0, 1), round(float(cy) + y0, 1), int(ar), [int(v) for v in col]])
        log[k].append(fr)
    n += 1
    if n % 900 == 0: print(n // FPS, "s", file=sys.stderr)
p.wait()
json.dump({"fps": FPS, "windows": wins, "log": log}, open(out, "w"))
print(f"{n} frames → {out}", file=sys.stderr)
