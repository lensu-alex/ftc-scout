"""Per-robot, per-frame launch signals for a whole match at 30 fps native, saved for the shooter classifier.
usage: .venv/bin/python shotfeat.py <clip> <start> <robots.json> <hive x0,y0,x1,y1> <out.npz>
For each robot track and frame: chroma streak above (single-diff px, double-diff px), grey small motion above,
yellow-mask new pixels above / inside, speed (sizes/s), x, y, size. Plus which robots exist per frame."""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, start, robpath, hiveS, out = sys.argv[1:6]; start = float(start)
hx0, hy0, hx1, hy1 = [int(v) for v in hiveS.split(",")]
R = json.load(open(robpath)); rstart = R["start"]
W, H, FPS, DUR = 1280, 720, 30, 160
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
ids = [r["id"] for r in R["robots"]]
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t); best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.6 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
N = int(DUR * FPS) + 5
F = {k: np.full((len(ids), N), np.nan, np.float32) for k in ["chroma1", "chroma2", "grey", "yel_above", "yel_inside", "speed", "x", "y", "s"]}
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", str(DUR), "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
Yp = Ypp = Gp = YMp = None; i = 0
def small(m, maxarea=300):
    lab, n = ndimage.label(m)
    if n:
        ar = ndimage.sum(m, lab, np.arange(1, n + 1)); big = np.nonzero(ar > maxarea)[0] + 1
        if len(big): m = m & ~np.isin(lab, big)
    return m
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3 or i >= N - 1: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16); t = i / FPS
    Y = (a[..., 0] + a[..., 1]) // 2 - a[..., 2]; G = a.sum(-1) // 3
    r, g, b = a[..., 0], a[..., 1], a[..., 2]; YM = (r > 130) & (g > 120) & (b < 0.7 * g) & (r >= 0.85 * g)
    boxes = {rid: at(rid, t) for rid in ids}
    if Yp is not None:
        c1 = (Y - Yp) > 14
        c2 = ((Yp - Ypp) > 14) & ((Yp - Y) > 14) if Ypp is not None else np.zeros_like(c1)
        gm = np.abs(G - Gp) > 30
        ym = YM & ~YMp
        for m in (c1, c2, gm, ym):
            m[hy0:hy1, hx0:hx1] = False; m[int(0.78 * H):] = False
        # not inside any robot box for the "above" signals
        inside = np.zeros((H, W), bool)
        for rid, q in boxes.items():
            if q: s = q["s"]; inside[int(max(0, q["y"] - 0.9 * s)):int(q["y"]), int(max(0, q["x"] - s / 2)):int(q["x"] + s / 2)] = True
        c1a, c2a, gma, yma = small(c1 & ~inside), small(c2 & ~inside), small(gm & ~inside), small(ym & ~inside)
        for k, rid in enumerate(ids):
            q = boxes[rid]
            if not q: continue
            s = q["s"]; top = q["y"] - 0.9 * s
            x0, x1 = int(max(0, q["x"] - 0.55 * s)), int(min(W, q["x"] + 0.55 * s)); y0, y1 = int(max(0, top - 1.0 * s)), int(min(H, top + 0.1 * s))
            bx0, bx1 = int(max(0, q["x"] - s / 2)), int(min(W, q["x"] + s / 2)); by0, by1 = int(max(0, top)), int(min(H, q["y"]))
            F["chroma1"][k, i] = c1a[y0:y1, x0:x1].sum(); F["chroma2"][k, i] = c2a[y0:y1, x0:x1].sum()
            F["grey"][k, i] = gma[y0:y1, x0:x1].sum(); F["yel_above"][k, i] = yma[y0:y1, x0:x1].sum()
            F["yel_inside"][k, i] = ym[by0:by1, bx0:bx1].sum()
            q2 = at(rid, t - 0.5)
            F["speed"][k, i] = (((q["x"] - q2["x"]) ** 2 + (q["y"] - q2["y"]) ** 2) ** 0.5 / 0.5 / s) if q2 else np.nan
            F["x"][k, i] = q["x"]; F["y"][k, i] = q["y"]; F["s"][k, i] = s
    Ypp, Yp, Gp, YMp = Yp, Y, G, YM; i += 1
    if i % 1500 == 0: print(i // FPS, "s", file=sys.stderr)
p.wait()
np.savez_compressed(out, ids=np.array(ids), fps=FPS, n=i, **F)
print(f"{i} frames, {len(ids)} robots → {out}", file=sys.stderr)
