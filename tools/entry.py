"""Experiment: attribute each scored volley by the balls' ENTRY velocity at the hive cell (where they are big and
visible), fitted against a projectile from each candidate robot's position.
usage: .venv/bin/python entry.py <clip> <start> <events.txt> <robots.json> <cell x0,y0,x1,y1> [marks.json]"""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, start, evpath, robpath, cellS = sys.argv[1:6]; start = float(start)
cx0, cy0, cx1, cy1 = [int(v) for v in cellS.split(",")]
marks = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else []
mark_t = sorted({round(m["t"], 2) for m in marks if m["who"] == "team"})
R = json.load(open(robpath)); rstart = R["start"]
events = [(float(l.split()[0]), l.split()[1]) for l in open(evpath) if l.strip()]
W, H, FPS = 1280, 720, 30
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t); best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.7 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
# window around the cell
wx0, wy0, wx1, wy1 = max(0, cx0 - 60), 0, min(W, cx1 + 60), min(H, cy1 + 40)

def decode(t0, dur):
    p = subprocess.Popen([FF, "-v", "error", "-ss", str(start + t0), "-i", clip, "-t", str(dur), "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
    out = []
    while True:
        buf = p.stdout.read(W * H * 3)
        if len(buf) < W * H * 3: break
        out.append(np.frombuffer(buf, np.uint8).reshape(H, W, 3)[wy0:wy1, wx0:wx1].astype(np.int16))
    p.wait(); return out

def entries(T):
    t0 = T - 2.2; F = decode(t0, 2.5)
    if len(F) < 10: return []
    bg = np.median(np.stack(F[:6]), axis=0)
    per = []
    for i, f in enumerate(F):
        d = np.abs(f - bg).sum(-1); grey = f.sum(-1) / 3
        r, g, b = f[..., 0], f[..., 1], f[..., 2]
        m = (d > 70) & (grey > 100) & (b < np.maximum(r, g) + 15)
        lab, n = ndimage.label(m); blobs = []
        if n:
            idx = np.arange(1, n + 1); ar = ndimage.sum(m, lab, idx); keep = (ar >= 8) & (ar <= 260)
            if keep.any():
                for (yy, xx), aa in zip(ndimage.center_of_mass(m, lab, idx[keep]), ar[keep]): blobs.append((xx + wx0, yy + wy0))
        per.append(blobs)
        # the background follows slowly (a ball that came to rest joins it after ~1 s)
        bg += 0.04 * (f - bg)
    # forward linking
    tracks, active = [], []
    for i, blobs in enumerate(per):
        used = set()
        for tr in active:
            px, py = tr[-1][1], tr[-1][2]
            if len(tr) > 1: px, py = 2 * px - tr[-2][1], 2 * py - tr[-2][2]
            best, bj = 26, -1
            for j, (bx, by) in enumerate(blobs):
                if j in used: continue
                dd = ((bx - px) ** 2 + (by - py) ** 2) ** 0.5
                if dd < best: best, bj = dd, j
            if bj >= 0: used.add(bj); tr.append((i, blobs[bj][0], blobs[bj][1]))
        still = []
        for tr in active:
            if tr[-1][0] < i - 1: tracks.append(tr)
            else: still.append(tr)
        active = still
        for j, (bx, by) in enumerate(blobs):
            if j not in used: active.append([(i, bx, by)])
    tracks += active
    out = []
    for tr in tracks:
        if len(tr) < 3: continue
        i0, x0, y0 = tr[0]
        # entry: first seen above the resting row and inside the cell's width (with a margin); moving ≥ 6 px/frame
        if not (cx0 - 25 <= x0 <= cx1 + 25 and y0 < cy1 - 20): continue
        k = min(3, len(tr) - 1)
        vx = (tr[k][1] - x0) / k * FPS; vy = (tr[k][2] - y0) / k * FPS
        if (vx ** 2 + vy ** 2) ** 0.5 < 6 * FPS: continue
        out.append((t0 + i0 / FPS, x0, y0, vx, vy, len(tr)))
    return out

def fit(robot, e):
    """Residual (px) of a projectile from the robot's top reaching the entry point with the measured velocity."""
    te, ex, ey, vx, vy, n = e
    rx, ry, s = robot["x"], robot["y"], robot["s"]
    lx, ly = rx, ry - 0.9 * s
    g = 21.3 * s          # px/s^2 at the robot's scale (robot ≈ 0.46 m)
    best = None
    for T in np.arange(0.15, 1.6, 0.01):
        dx = (ex - lx) - vx * T
        dy = (ey - ly) - (vy * T - 0.5 * g * T * T)
        c = (dx * dx + dy * dy) ** 0.5
        if best is None or c < best[0]: best = (c, T)
    return best

for T, kind in events:
    if kind != "scored": continue
    es = entries(T)
    truth = "TEAM" if any(-0.5 <= T - m <= 2.0 for m in mark_t) else "other"
    if not es:
        print(f"{T:7.2f} {truth:5s} | no entry seen"); continue
    tally = {}
    for e in es:
        rob = [(rid, at(rid, e[0] - 0.5)) for rid in pos]
        rob = [(rid, q) for rid, q in rob if q]
        res = sorted(((fit(q, e)[0] / q["s"], rid) for rid, q in rob))
        for c, rid in res[:1]: tally[rid] = tally.get(rid, 0) + 1
        print(f"{T:7.2f} {truth:5s} | entry t={e[0]:.2f} at ({e[1]:.0f},{e[2]:.0f}) v=({e[3]:+.0f},{e[4]:+.0f}) px/s {e[5]}pts | fit (robot sizes): " + "  ".join(f"{rid}:{c:.1f}" for c, rid in res[:4]))
    print(f"        → votes {tally}")
