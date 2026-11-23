"""Experiment: count pollen as discs inside the hive box (for cameras looking down on the hive), robots excluded.
usage: .venv/bin/python disc_count.py <clip> <start> <robots.json> x0,y0,x1,y1 [ballDiameterPx]"""
import sys, json, subprocess, bisect, numpy as np
from scipy import ndimage
clip, start, robpath, boxS = sys.argv[1:5]; start = float(start)
x0, y0, x1, y1 = [int(v) for v in boxS.split(",")]
D = float(sys.argv[5]) if len(sys.argv) > 5 else 13 * (x1 - x0) / 145
R = json.load(open(robpath)); rstart = R["start"]
pos = {r["id"]: ([q["t"] - rstart for q in r["path"]], r["path"]) for r in R["robots"]}
def boxes(t):
    out = []
    for rid, (ts, P) in pos.items():
        k = bisect.bisect_left(ts, t); best = None
        for j in (k - 1, k):
            if 0 <= j < len(ts) and abs(ts[j] - t) <= 0.4 and (best is None or abs(ts[j] - t) < abs(ts[best] - t)): best = j
        if best is not None: q = P[best]; s = q["s"] * 1.15; out.append((q["x"] - s / 2, q["y"] - s, q["x"] + s / 2, q["y"] + 0.1 * s))
    return out
W, H, FPS = 1280, 720, 10
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", "160", "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
counts = []; i = 0
amin, amax = 0.35 * (np.pi / 4) * D * D, 1.8 * (np.pi / 4) * D * D
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    t = i / FPS; i += 1
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)[y0:y1, x0:x1].astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 150) & (g > 150) & (b < 0.65 * g) & (r >= 0.85 * g)
    for bx0, by0, bx1, by1 in boxes(t):
        X0, Y0, X1, Y1 = int(max(0, bx0 - x0)), int(max(0, by0 - y0)), int(min(x1 - x0, bx1 - x0)), int(min(y1 - y0, by1 - y0))
        if X1 > X0 and Y1 > Y0: m[Y0:Y1, X0:X1] = False
    lab, n = ndimage.label(m); c = 0
    for k, s in enumerate(ndimage.find_objects(lab), 1):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start; area = int((lab[s] == k).sum())
        if area < amin: continue
        asp = w / h if h else 9
        if 0.55 <= asp <= 1.8 and area / (w * h) >= 0.5:
            c += max(1, round(area / ((np.pi / 4) * D * D)))      # merged discs count by area
    counts.append((round(t, 1), c))
p.wait()
# per second median count, then steps
import statistics
sec = {}
for t, c in counts: sec.setdefault(int(t), []).append(c)
med = [statistics.median(sec[k]) for k in sorted(sec)]
print(" ".join(f"{k}:{int(v)}" for k, v in enumerate(med)))
# a count only "arrives" when it holds for 2 s (robots passing, flicker don't)
stable = []; level = med[0]; ups = 0; k = 1
while k < len(med):
    if med[k] != level and k + 1 < len(med) and med[k + 1] == med[k]:
        if med[k] > level: ups += med[k] - level
        level = med[k]; k += 2
    else: k += 1
print(f"disc diameter {D:.1f}px; total steps up (balls arrived) {int(ups)}; max at once {int(max(med))}")
