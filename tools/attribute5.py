"""Who shot? Chroma cue: new yellowness (a pale ball streak) appearing just above a robot in the 1.6 s
before the balls arrive at the hive, at 30 fps native. Scored relative to that robot's usual level.
usage: .venv/bin/python attribute4.py <clip> <start> <events.txt> <robots.json> <hive x0,y0,x1,y1> [marks.json]"""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, start, evpath, robpath, hiveS = sys.argv[1:6]; start = float(start)
hx0, hy0, hx1, hy1 = [int(v) for v in hiveS.split(",")]
marks = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else []
mark_t = sorted({round(m["t"], 2) for m in marks if m["who"] == "team"})
R = json.load(open(robpath)); rstart = R["start"]
events = [(float(l.split()[0]), l.split()[1]) for l in open(evpath) if l.strip()]
scored = [t for t, k in events if k == "scored"]
W, H, FPS = 1280, 720, 30
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t); best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.6 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
def region(q):
    s = q["s"]; w = s; top = q["y"] - 0.9 * s
    return int(max(0, q["x"] - 0.55 * w)), int(max(0, top - 1.0 * s)), int(min(W, q["x"] + 0.55 * w)), int(min(H, top + 0.1 * s))

p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", "160", "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
prevY = None; prevprevY = None; i = 0
act = {rid: [] for rid in pos}
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16); t = i / FPS; i += 1
    Y = (a[..., 0] + a[..., 1]) // 2 - a[..., 2]
    if prevprevY is not None:
        # yellowness that appeared in the PREVIOUS frame and is gone again now: a streak, not a rolling ball
        m = ((prevY - prevprevY) > 14) & ((prevY - Y) > 14)
        t = t - 1 / FPS
        m[hy0:hy1, hx0:hx1] = False                      # not the hive (balls arriving / sign)
        m[int(0.78 * H):] = False                          # not the overlay
        boxes = {rid: at(rid, t) for rid in pos}
        for rid, q in boxes.items():                       # not inside any robot (carried balls, lights)
            if q: s = q["s"]; m[int(max(0, q["y"] - 0.9 * s)):int(q["y"]), int(max(0, q["x"] - s / 2)):int(q["x"] + s / 2)] = False
        lab, n = ndimage.label(m)
        if n:
            ar = ndimage.sum(m, lab, np.arange(1, n + 1)); big = np.nonzero(ar > 300)[0] + 1   # people, robots driving by
            if len(big): m &= ~np.isin(lab, big)
        for rid, q in boxes.items():
            if not q: continue
            x0, y0, x1, y1 = region(q)
            act[rid].append((t, int(m[y0:y1, x0:x1].sum())))
    prevprevY = prevY; prevY = Y
p.wait()
base = {rid: (np.percentile([a[1] for a in A], 60) + 2) if A else 2 for rid, A in act.items()}
print("event  marks | robots: raw px (x usual) in the 1.6 s before the arrival; best→")
rows = []
for T in scored:
    truth = "TEAM" if any(-0.5 <= T - m <= 2.0 for m in mark_t) else "other"
    row = []
    for rid, A in act.items():
        win = [a for a in A if T - 1.8 <= a[0] <= T - 0.2]
        if len(win) < 12: continue
        raw = sum(a[1] for a in win); rel = raw / (base[rid] * len(win))
        q = at(rid, T - 0.9)
        row.append((rid, raw, rel, q["x"] if q else 0, q["y"] if q else 0))
    row.sort(key=lambda x: -x[2])
    print(f"{T:7.2f} {truth:5s} | " + "  ".join(f"{rid}:{raw}({rel:.1f}x)@({x:.0f},{y:.0f})" for rid, raw, rel, x, y in row[:5]))
