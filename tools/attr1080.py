"""Per-robot launch evidence at 1080p: new yellowness (a ball leaving) just above each robot, per frame.
usage: .venv/bin/python attr1080.py <clip1080> <clipStartInMatch> <robots.json> <out.npz> [cells x0,y0,x1,y1;...  (720p coords)]"""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, cstart, robpath, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
cells = [[int(v) * 1.5 for v in c.split(",")] for c in (sys.argv[5].split(";") if len(sys.argv) > 5 else [])]
R = json.load(open(robpath)); rstart = R["start"]; SC = 1.5
W, H, FPS = 1920, 1080, 30
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
ids = [r["id"] for r in R["robots"]]
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t); best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.6 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
p = subprocess.Popen([FF, "-v", "error", "-i", clip, "-vf", f"fps={FPS}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)
Yp = None; i = 0
T, A, B = [], [], []     # time, above-count per robot, blobs-above per robot
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16); t = cstart + i / FPS; i += 1
    r, g, b = a[..., 0], a[..., 1], a[..., 2]; Y = (r + g) // 2 - b
    boxes = {rid: at(rid, t) for rid in ids}
    if Yp is not None:
        m = (Y - Yp > 12) & (r > 120) & (g > 110) & (b < 0.8 * g)
        m[int(0.78 * H):] = False
        for x0, y0, x1, y1 in cells: m[int(y0):int(y1), int(x0):int(x1)] = False       # balls arriving in the cell
        for rid, q in boxes.items():
            if q: s = q["s"] * SC; m[int(max(0, q["y"] * SC - 0.9 * s)):int(q["y"] * SC), int(max(0, q["x"] * SC - s / 2)):int(q["x"] * SC + s / 2)] = False
        lab, n = ndimage.label(m)
        if n:
            ar = ndimage.sum(m, lab, np.arange(1, n + 1)); big = np.nonzero(ar > 450)[0] + 1
            if len(big): m &= ~np.isin(lab, big)
            lab, n = ndimage.label(m)
        row_a, row_b = [], []
        for rid in ids:
            q = boxes[rid]
            if not q: row_a.append(np.nan); row_b.append(np.nan); continue
            s = q["s"] * SC; top = q["y"] * SC - 0.9 * s
            x0, x1 = int(max(0, q["x"] * SC - 0.6 * s)), int(min(W, q["x"] * SC + 0.6 * s)); y0, y1 = int(max(0, top - 1.2 * s)), int(min(H, top + 0.1 * s))
            sub = m[y0:y1, x0:x1]; row_a.append(int(sub.sum()))
            row_b.append(len(np.unique(lab[y0:y1, x0:x1])) - 1 if sub.any() else 0)
        T.append(t); A.append(row_a); B.append(row_b)
    Yp = Y
p.wait()
np.savez_compressed(out, t=np.array(T), above=np.array(A, np.float32), blobs=np.array(B, np.float32), ids=np.array(ids))
print(f"{i} frames → {out}", file=sys.stderr)
