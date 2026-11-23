"""Experiment: trace arriving balls backwards from the hive cell to the robot that launched them.
30 fps native frames around each scored event; small fast-changing blobs (not inside robot boxes) are
linked backwards in time starting from blobs at the cell; the lowest/earliest point of a long path is
the launch point; the robot whose box is nearest below it is the shooter.
usage: .venv/bin/python backtrack.py <clip> <start> <events.txt> <robots.json> <cell x0,y0,x1,y1> [marks.json]"""
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
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.6 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
def boxes(t):
    out = []
    for rid in pos:
        q = at(rid, t)
        if q: out.append((rid, q["x"] - q["s"] / 2, q["y"] - 0.9 * q["s"], q["x"] + q["s"] / 2, q["y"], q["s"]))
    return out

def decode(t0, dur):
    p = subprocess.Popen([FF, "-v", "error", "-ss", str(start + t0), "-i", clip, "-t", str(dur), "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
    out = []
    while True:
        buf = p.stdout.read(W * H * 3)
        if len(buf) < W * H * 3: break
        out.append(np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy())
    p.wait(); return out

for T, kind in events:
    if kind != "scored": continue
    t0 = T - 2.2; F = decode(t0, 2.4)
    grey = [f.astype(np.int16).sum(-1) // 3 for f in F]
    # per frame: small blobs that changed vs both neighbours (a ball in flight), outside robot boxes, above the floor
    per = []
    for i in range(1, len(F) - 1):
        d = np.minimum(np.abs(grey[i] - grey[i - 1]), np.abs(grey[i] - grey[i + 1]))
        f = F[i].astype(np.int16); r, g, b = f[..., 0], f[..., 1], f[..., 2]
        m = (d > 35) & (r > 110) & (g > 100) & (b < 0.85 * g)     # changed and at least a bit yellow / pale
        m[560:] = False; m[:, :60] = False; m[:, 1220:] = False      # not the overlay, not the edges
        for rid, x0, y0, x1, y1, s in boxes(t0 + i / FPS):
            m[int(max(0, y0)):int(min(H, y1)), int(max(0, x0)):int(min(W, x1))] = False
        lab, n = ndimage.label(m); blobs = []
        if n:
            idx = np.arange(1, n + 1); ar = ndimage.sum(m, lab, idx); keep = (ar >= 5) & (ar <= 220)
            if keep.any():
                for (yy, xx), aa in zip(ndimage.center_of_mass(m, lab, idx[keep]), ar[keep]): blobs.append((float(xx), float(yy)))
        per.append(blobs)
    # backward linking from blobs at / just above the cell
    paths = []
    for i in range(len(per) - 1, 1, -1):
        for (x, y) in per[i]:
            if not (cx0 - 30 <= x <= cx1 + 30 and cy0 - 60 <= y <= cy1 + 20): continue
            path = [(i, x, y)]; vx = vy = 0.0; miss = 0; j = i - 1
            while j >= 0 and miss <= 1:
                px, py = path[-1][1] - vx, path[-1][2] - vy
                gate = 28 if len(path) > 1 else 45
                cand = [(((bx - px) ** 2 + (by - py) ** 2) ** 0.5, bx, by) for bx, by in per[j]]
                cand = [c for c in cand if c[0] < gate]
                if cand:
                    dd, bx, by = min(cand)
                    if len(path) > 1: vx, vy = 0.5 * vx + 0.5 * (path[-1][1] - bx), 0.5 * vy + 0.5 * (path[-1][2] - by)
                    else: vx, vy = path[-1][1] - bx, path[-1][2] - by
                    path.append((j, bx, by)); miss = 0
                else: miss += 1
                j -= 1
            if len(path) >= 6:
                (i1, x1, y1), (i0, x0, y0) = path[0], path[-1]
                if ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 >= 100: paths.append(path)
    truth = "TEAM" if any(-0.5 <= T - m <= 2.0 for m in mark_t) else "other"
    # keep distinct paths (different start points)
    uniq = []
    for p in sorted(paths, key=len, reverse=True):
        if all(abs(p[-1][1] - q[-1][1]) + abs(p[-1][2] - q[-1][2]) > 25 for q in uniq): uniq.append(p)
    votes = {}
    desc = []
    for p in uniq[:4]:
        i0, lx, ly = p[-1]; tl = t0 + (i0 + 1) / FPS
        # the robot nearest below the launch point (within 1.5 sizes sideways, launch point above its top by < 2 sizes)
        best = None
        for rid, x0, y0, x1, y1, s in boxes(tl):
            dx = max(0, abs(lx - (x0 + x1) / 2) - s / 2) / s; dy = (y0 - ly) / s
            if dx <= 1.5 and -1.0 <= dy <= 2.5:
                cost = dx + max(0, dy) * 0.5
                if best is None or cost < best[0]: best = (cost, rid)
        desc.append(f"{len(p)}pts ({lx:.0f},{ly:.0f})@{tl:.2f}→cell" + (f" robot {best[1]}" if best else " robot ?"))
        if best: votes[best[1]] = votes.get(best[1], 0) + 1
    print(f"{T:7.2f} {truth:5s} | votes {votes} | " + " ; ".join(desc[:3]))
