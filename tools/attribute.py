"""Experiment: which robot shot each scored volley? Around each scored event, read 30 fps native frames,
track fast yellow blobs heading for the hive cell, fit their path and extend it down to the floor; the
alliance robot nearest to where the line meets the robots' level is the shooter.
usage: .venv/bin/python attribute.py <clip> <start> <events.txt> <robots.json> <cell x0,y0,x1,y1> [marks.json]"""
import sys, json, subprocess, numpy as np
from scipy import ndimage
clip, start, evpath, robpath, cellS = sys.argv[1:6]
start = float(start); cx0, cy0, cx1, cy1 = [int(v) for v in cellS.split(",")]
marks = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else []
mark_t = sorted({round(m["t"], 2) for m in marks if m["who"] == "team"})
R = json.load(open(robpath)); rstart = R["start"]
events = [(float(l.split()[0]), l.split()[1], l.split()[2]) for l in open(evpath) if l.strip()]
W, H, FPS = 1280, 720, 30
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
# region where balls fly towards the cell: the cell plus a margin around and below it
rx0, ry0, rx1, ry1 = max(0, cx0 - 250), 0, min(W, cx1 + 250), min(H, cy1 + 300)

def frames(t0, dur):
    p = subprocess.Popen([FF, "-v", "error", "-ss", str(start + t0), "-i", clip, "-t", str(dur), "-vf", f"fps={FPS},scale={W}:{H}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
    i = 0
    while True:
        buf = p.stdout.read(W * H * 3)
        if len(buf) < W * H * 3: break
        yield t0 + i / FPS, np.frombuffer(buf, np.uint8).reshape(H, W, 3)[ry0:ry1, rx0:rx1].astype(np.int16); i += 1
    p.wait()

def robots_at(t):
    out = []
    for r in R["robots"]:
        q = min(r["path"], key=lambda p: abs(p["t"] - (rstart + t)))
        if abs(q["t"] - (rstart + t)) <= 0.6: out.append((r["id"], q["x"], q["y"], q["s"]))
    return out

for t, kind, val in events:
    if kind != "scored": continue
    # balls arrive in the ~1.5 s before the plateau settles
    bg = None; tracks = []; active = []
    for ft, a in frames(t - 1.6, 1.9):
        c = a.astype(np.float32)
        if bg is None: bg = c.copy(); continue
        d = np.abs(c - bg).sum(-1); bg += 0.25 * (c - bg)
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        yel = (d > 80) & (r > 130) & (g > 130) & (b < 0.8 * g)       # moving, yellowish (pale in flight)
        lab, n = ndimage.label(yel)
        blobs = []
        if n:
            idx = np.arange(1, n + 1); ar = ndimage.sum(yel, lab, idx); keep = (ar >= 6) & (ar <= 400)
            if keep.any():
                for (yy, xx), aa in zip(ndimage.center_of_mass(yel, lab, idx[keep]), ar[keep]): blobs.append((xx + rx0, yy + ry0))
        used = set()
        for tr in active:
            px, py = tr[-1][1], tr[-1][2]
            if len(tr) > 1: px, py = 2 * px - tr[-2][1], 2 * py - tr[-2][2]
            best, bj = 30, -1
            for j, (bx, by) in enumerate(blobs):
                if j in used: continue
                dd = ((bx - px) ** 2 + (by - py) ** 2) ** 0.5
                if dd < best: best, bj = dd, j
            if bj >= 0: used.add(bj); tr.append((ft, blobs[bj][0], blobs[bj][1]))
        active = [tr for tr in active if tr[-1][0] >= ft - 2.5 / FPS] ; tracks += [tr for tr in active if False]
        for j, (bx, by) in enumerate(blobs):
            if j not in used: active.append([(ft, bx, by)])
        tracks = [tr for tr in tracks] + []
        # move finished tracks
        done = [tr for tr in active if tr[-1][0] < ft - 2.5 / FPS]
    tracks = active
    # arriving balls: tracks of 4+ points whose last point is in or just above the cell and that travelled 40+ px
    arrivals = []
    for tr in tracks:
        if len(tr) < 4: continue
        (t0, x0, y0), (t1, x1, y1) = tr[0], tr[-1]
        if not (cx0 - 20 <= x1 <= cx1 + 20 and cy0 - 40 <= y1 <= cy1 + 10): continue
        if ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 < 40: continue
        # fit a line to the path (x as a function of y), extend to the robots' level
        xs = np.array([p[1] for p in tr]); ys = np.array([p[2] for p in tr])
        A = np.vstack([ys, np.ones_like(ys)]).T; k, m = np.linalg.lstsq(A, xs, rcond=None)[0]
        arrivals.append((t0, x0, y0, x1, y1, k, m))
    rob = robots_at(t - 0.8)
    truth = "TEAM" if any(abs(t - mt) <= 2.0 and t - mt >= -0.5 for mt in mark_t) else "other"
    if not arrivals:
        print(f"{t:7.2f} +{val}  {truth:5s} no arriving ball seen; robots {[(r[0], r[1], r[2]) for r in rob]}"); continue
    # where the lines meet each robot's level (bottom y): nearest robot per arrival
    votes = {}
    for (t0, x0, y0, x1, y1, k, m) in arrivals:
        for rid, rx, ry, rs in rob:
            xr = k * ry + m
            dist = abs(xr - rx) / max(rs, 1)
            votes[rid] = min(votes.get(rid, 9e9), dist)
    ranked = sorted(votes.items(), key=lambda kv: kv[1])
    desc = " ".join(f"({x0:.0f},{y0:.0f})→({x1:.0f},{y1:.0f})" for (t0, x0, y0, x1, y1, k, m) in arrivals[:3])
    print(f"{t:7.2f} +{val}  {truth:5s} {len(arrivals)} arrivals {desc} | nearest robots {[(rid, round(d, 1)) for rid, d in ranked[:3]]}")
