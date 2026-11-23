"""Experiment: who shot? For each scored event and each robot: was it still, and was there change inside
its box (balls being fed / launched) in the 1.5 s before the balls arrived at the hive.
usage: .venv/bin/python stillshoot.py <clip> <start> <events.txt> <robots.json> [marks.json]"""
import sys, json, subprocess, numpy as np
clip, start, evpath, robpath = sys.argv[1:5]; start = float(start)
marks = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else []
mark_t = sorted({round(m["t"], 2) for m in marks if m["who"] == "team"})
R = json.load(open(robpath)); rstart = R["start"]
events = [(float(l.split()[0]), l.split()[1]) for l in open(evpath) if l.strip()]
scored = [t for t, k in events if k == "scored"]
W, H, FPS = 1280, 720, 10
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", "160", "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE, bufsize=W * H * 8)
prev = None; i = 0
# per robot: list of (t, speed in sizes/s, internal change per px)
feat = {r["id"]: [] for r in R["robots"]}
import bisect
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def at(rid, t):
    ts, P = pos[rid]; k = bisect.bisect_left(ts, t)
    best = None
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.4 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None
while True:
    buf = p.stdout.read(W * H)
    if len(buf) < W * H: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W).astype(np.int16); t = i / FPS; i += 1
    if prev is not None:
        d = np.abs(a - prev)
        for r in R["robots"]:
            q = at(r["id"], t); q2 = at(r["id"], t - 0.5)
            if not q or not q2: continue
            s = q["s"]; x0, y0, x1, y1 = int(q["x"] - s / 2), int(q["y"] - 0.9 * s), int(q["x"] + s / 2), int(q["y"])
            x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
            if x1 <= x0 or y1 <= y0: continue
            speed = ((q["x"] - q2["x"]) ** 2 + (q["y"] - q2["y"]) ** 2) ** 0.5 / 0.5 / s
            feat[r["id"]].append((t, speed, float(d[y0:y1, x0:x1].mean())))
    prev = a
p.wait()
print("event   truth | per robot: id(speed sizes/s, inner change) over the 1.5 s before; '*' = still (<0.3) ")
for t in scored:
    truth = "TEAM" if any(-0.5 <= t - m <= 2.0 for m in mark_t) else "other"
    row = []
    for rid, F in feat.items():
        win = [f for f in F if t - 1.8 <= f[0] <= t - 0.3]
        if len(win) < 5: continue
        sp = float(np.median([f[1] for f in win])); ch = float(np.mean([f[2] for f in win]))
        row.append((rid, sp, ch))
    row.sort(key=lambda x: -x[2])
    print(f"{t:7.2f} {truth:5s} | " + "  ".join(f"{rid}({sp:.2f}{'*' if sp < 0.3 else ' '},{ch:4.1f})" for rid, sp, ch in row))
