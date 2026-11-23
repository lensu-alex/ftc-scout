"""Experiment: how many pollen rest in a hive cell. Balls line up in a row at the bottom of the cell;
project yellow pixels of the row band onto x and count bumps about one ball apart.
usage: .venv/bin/python row_count.py <clip> <start> <out.json> x0,y0,x1,y1 [fps=10]"""
import sys, json, subprocess, numpy as np
clip, start, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
x0, y0, x1, y1 = [int(v) for v in sys.argv[4].split(",")]
FPS = int(sys.argv[5]) if len(sys.argv) > 5 else 10
W, H, DUR = 1280, 720, 160
BALL = 13  # px diameter at this camera distance (measured)
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", str(DUR), "-vf", f"fps={FPS},scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
series = []
n = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    c = a[y0:y1, x0:x1].astype(np.int16); r, g, b = c[..., 0], c[..., 1], c[..., 2]
    yel = (r > 150) & (g > 150) & (b < 0.65 * g) & (r >= 0.85 * g)
    prof = yel.sum(0).astype(float)                       # yellow pixels per column
    k = np.ones(5) / 5; sm = np.convolve(prof, k, "same")
    # bumps: local maxima at least BALL*0.7 apart and at least 3 px tall
    peaks = []
    i = 1
    while i < len(sm) - 1:
        if sm[i] >= 3 and sm[i] >= sm[i - 1] and sm[i] >= sm[i + 1]:
            if peaks and i - peaks[-1] < BALL * 0.7:
                if sm[i] > sm[peaks[-1]]: peaks[-1] = i
            else: peaks.append(i)
        i += 1
    # a wide flat bump = several balls side by side: width / BALL
    count = 0
    for pk in peaks:
        l = pk
        while l > 0 and sm[l - 1] >= 3: l -= 1
        rr = pk
        while rr < len(sm) - 1 and sm[rr + 1] >= 3: rr += 1
        count += 1
    # alternative: total yellow run length / BALL
    runlen = (sm >= 3).sum()
    series.append([round(n / FPS, 2), len(peaks), int(runlen), int(yel.sum())])
    n += 1
p.wait()
json.dump({"fps": FPS, "series": series}, open(out, "w"))
print(f"{n} frames → {out}", file=sys.stderr)
