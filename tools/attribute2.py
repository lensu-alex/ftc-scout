"""Experiment: who shot? In the 1.5 s before balls arrive at the hive, which robot has yellow moving
above / inside it (balls leaving). 30 fps native; score relative to the robot's own usual activity.
usage: .venv/bin/python attribute2.py <clip> <start> <events.txt> <robots.json> [marks.json]"""
import sys, json, subprocess, bisect, numpy as np
clip, start, evpath, robpath = sys.argv[1:5]; start = float(start)
marks = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else []
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
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.5 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
    return P[best] if best is not None else None

p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", "160", "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
prev = None; i = 0
act = {r["id"]: [] for r in R["robots"]}     # (t, moving-yellow px above the robot, inside the robot)
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16); t = i / FPS; i += 1
    r_, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
    yel = (r_ > 130) & (g_ > 120) & (b_ < 0.7 * g_) & (r_ >= 0.85 * g_)
    if prev is not None:
        mov = yel & ~prev
        for rid in act:
            q = at(rid, t)
            if not q: continue
            s = q["s"]; x0, x1 = int(max(0, q["x"] - 0.7 * s)), int(min(W, q["x"] + 0.7 * s))
            yb, yt = int(q["y"]), int(max(0, q["y"] - 0.9 * s)); ya = int(max(0, yt - 1.2 * s))
            act[rid].append((t, int(mov[ya:yt, x0:x1].sum()), int(mov[yt:yb, x0:x1].sum())))
    prev = yel
p.wait()
base = {rid: (np.median([a[1] for a in A]) + 1, np.median([a[2] for a in A]) + 1) if A else (1, 1) for rid, A in act.items()}
print("event   truth | robots ranked by yellow motion ABOVE them in the 1.5 s before (sum px, x usual) ; inside")
for t in scored:
    truth = "TEAM" if any(-0.5 <= t - m <= 2.0 for m in mark_t) else "other"
    row = []
    for rid, A in act.items():
        win = [a for a in A if t - 1.7 <= a[0] <= t - 0.2]
        if len(win) < 10: continue
        above = sum(a[1] for a in win); inside = sum(a[2] for a in win)
        row.append((rid, above, above / (base[rid][0] * len(win)), inside))
    row.sort(key=lambda x: -x[1])
    print(f"{t:7.2f} {truth:5s} | " + "  ".join(f"{rid}:{ab}({rel:.1f}x; in {ins})" for rid, ab, rel, ins in row[:5]))
