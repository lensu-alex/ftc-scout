"""Launches per robot from 1080p 30 fps video: yellow balls that appear (chroma change) above a robot and move
away over 3+ frames. Robot boxes come from the 720p analysis (scaled x1.5).
usage: .venv/bin/python flights1080.py <clip1080> <clipStartInMatch> <robots.json> <out.json>"""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, cstart, robpath, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
R = json.load(open(robpath)); rstart = R["start"]; SC = 1.5
W, H, FPS = 1920, 1080, 30
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t); best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.6 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
def boxes(t):  # in 1080p px: (id, x0, y0(top), x1, y1(bottom), s)
    out = []
    for rid in pos:
        q = at(rid, t)
        if q: s = q["s"] * SC; out.append((rid, q["x"] * SC - s / 2, q["y"] * SC - 0.9 * s, q["x"] * SC + s / 2, q["y"] * SC, s))
    return out
p = subprocess.Popen([FF, "-v", "error", "-i", clip, "-vf", f"fps={FPS}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)
Yp = None; i = 0; per = []
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16); t = cstart + i / FPS; i += 1
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    Y = (r + g) // 2 - b
    blobs = []
    if Yp is not None:
        m = (Y - Yp > 12) & (r > 120) & (g > 110) & (b < 0.8 * g)
        m[int(0.78 * H):] = False
        # not inside robots (carried balls, lights)
        for rid, x0, y0, x1, y1, s in boxes(t): m[int(max(0, y0)):int(min(H, y1)), int(max(0, x0)):int(min(W, x1))] = False
        lab, n = ndimage.label(m)
        if n:
            idx = np.arange(1, n + 1); ar = ndimage.sum(m, lab, idx); keep = (ar >= 6) & (ar <= 500)
            if keep.any():
                for (yy, xx), aa in zip(ndimage.center_of_mass(m, lab, idx[keep]), ar[keep]): blobs.append((float(xx), float(yy), int(aa)))
    per.append((t, blobs)); Yp = Y
p.wait()
# link forward
tracks, active = [], []
for fi, (t, blobs) in enumerate(per):
    used = set()
    for tr in active:
        px, py = tr["pts"][-1][1], tr["pts"][-1][2]
        if len(tr["pts"]) > 1: px, py = 2 * px - tr["pts"][-2][1], 2 * py - tr["pts"][-2][2]
        gate = 40 if len(tr["pts"]) > 1 else 70
        best, bj = gate, -1
        for j, (bx, by, ar) in enumerate(blobs):
            if j in used: continue
            d = ((bx - px) ** 2 + (by - py) ** 2) ** 0.5
            if d < best: best, bj = d, j
        if bj >= 0: used.add(bj); tr["pts"].append((t, blobs[bj][0], blobs[bj][1])); tr["miss"] = 0
        else: tr["miss"] += 1
    keep = []
    for tr in active:
        if tr["miss"] > 1: tracks.append(tr)
        else: keep.append(tr)
    active = keep
    for j, (bx, by, ar) in enumerate(blobs):
        if j not in used: active.append({"pts": [(t, bx, by)], "miss": 0})
tracks += active
launches = []
for tr in tracks:
    P = tr["pts"]
    if len(P) < 3: continue
    (t0, x0, y0), (t1, x1, y1) = P[0], P[-1]
    disp = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    if disp < 50 or y1 > y0 + 10: continue           # must travel and must rise overall
    # started just above a robot's top, within its width
    best = None
    for rid, bx0, by0, bx1, by1, s in boxes(t0):
        if bx0 - 0.3 * s <= x0 <= bx1 + 0.3 * s and by0 - 1.3 * s <= y0 <= by0 + 0.3 * s:
            d = abs(x0 - (bx0 + bx1) / 2) / s + max(0, by0 - y0) / s
            if best is None or d < best[0]: best = (d, rid)
    if best: launches.append({"t": round(t0, 2), "robot": best[1], "x": int(x0), "y": int(y0), "n": len(P), "disp": int(disp)})
launches.sort(key=lambda l: l["t"])
json.dump(launches, open(out, "w"))
for l in launches: print(l)
print(len(launches), "launches", file=sys.stderr)
