"""Experiment: count pollen launches from 30 fps native-resolution video.
Moving yellow blobs (not scenery, not inside a robot box) are linked frame to frame with a
constant-velocity model; a chain of 4+ steps moving fast and smoothly = one ball in flight.
usage: .venv/bin/python flights.py <clip> <matchStartInClip> <out.json> [fps=30] [dur=160]"""
import sys, json, subprocess, numpy as np
from scipy import ndimage
clip, start, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
FPS = float(sys.argv[4]) if len(sys.argv) > 4 else 30
DUR = float(sys.argv[5]) if len(sys.argv) > 5 else 160
W, H = 1280, 720
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", str(DUR), "-vf", f"fps={FPS},scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
rate = np.zeros((H, W), np.float32)   # how often each pixel is yellow (scenery)
blobs = []                             # per frame: list of (x, y, area)
n = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    yel = (r > 120) & (g > 110) & (b < 0.6 * g) & (r >= 0.9 * g) & (r - g < 70)
    rate += (yel.astype(np.float32) - rate) * (1 / 30)   # ~1 s memory: a ball parked 2 s becomes scenery
    mov = yel & (rate < 0.35)
    lab, k = ndimage.label(mov)
    fr = []
    if k:
        idx = np.arange(1, k + 1)
        areas = ndimage.sum(mov, lab, idx)
        keep = (areas >= 4) & (areas <= 400)
        if keep.any():
            cs = ndimage.center_of_mass(mov, lab, idx[keep])
            for (cy, cx), ar in zip(cs, areas[keep]): fr.append((round(float(cx), 1), round(float(cy), 1), int(ar)))
    blobs.append(fr); n += 1
    if n % 600 == 0: print(n // FPS, "s", file=sys.stderr)
p.wait()
print(f"{n} frames", file=sys.stderr)

# link blobs into flights
GATE0, GATE = 70, 22            # px: first step (unknown velocity), then around the predicted spot
MINSTEPS, MINSPEED = 4, 12      # frames, px/frame average
active, done = [], []
for i, fr in enumerate(blobs):
    used = set()
    for tr in active:
        pts = tr["pts"]
        if len(pts) == 1: px, py, gate = pts[-1][0], pts[-1][1], GATE0
        else:
            vx, vy = pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]
            px, py, gate = pts[-1][0] + vx, pts[-1][1] + vy, GATE
        best, bj = gate, -1
        for j, (x, y, ar) in enumerate(fr):
            if j in used: continue
            d = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
            if d < best: best, bj = d, j
        if bj >= 0 and (len(pts) > 1 or (fr[bj][0] - px) ** 2 + (fr[bj][1] - py) ** 2 >= 8 ** 2):
            used.add(bj); pts.append((fr[bj][0], fr[bj][1], i)); tr["miss"] = 0
        else:
            tr["miss"] += 1
    still = []
    for tr in active:
        if tr["miss"] > 1: done.append(tr)
        else: still.append(tr)
    active = still
    for j, (x, y, ar) in enumerate(fr):
        if j not in used: active.append({"pts": [(x, y, i)], "miss": 0})
done += active

flights = []
for tr in done:
    pts = tr["pts"]
    if len(pts) < MINSTEPS + 1: continue
    (x0, y0, i0), (x1, y1, i1) = pts[0], pts[-1]
    dist = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    if dist / (i1 - i0) < MINSPEED: continue
    # smooth: direction between consecutive steps changes little
    steps = [(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(len(pts) - 1)]
    turns = []
    for k in range(len(steps) - 1):
        (ax, ay), (bx, by) = steps[k], steps[k + 1]
        na, nb = (ax * ax + ay * ay) ** 0.5, (bx * bx + by * by) ** 0.5
        turns.append((ax * bx + ay * by) / (na * nb + 1e-6))
    if min(turns) < 0.5: continue
    flights.append({"t": round(i0 / FPS, 2), "t1": round(i1 / FPS, 2), "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "n": len(pts), "speed": round(dist / (i1 - i0), 1), "pts": pts})
json.dump({"fps": FPS, "flights": flights}, open(out, "w"))
print(f"{len(flights)} flights → {out}", file=sys.stderr)
