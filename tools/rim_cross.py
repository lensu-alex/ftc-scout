"""Experiment: count balls entering a hive cell = yellow blobs tracked at 30 fps that cross the cell's
rim line downwards inside the cell's x-range (and don't come back out within 0.5 s).
usage: .venv/bin/python rim_cross.py <clip> <start> <out.json> x0,y0,x1,y1 rimY"""
import sys, json, subprocess, numpy as np
from scipy import ndimage
clip, start, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
x0, y0, x1, y1 = [int(v) for v in sys.argv[4].split(",")]; RIM = int(sys.argv[5])
W, H, FPS, DUR = 1280, 720, 30, 160
FF = "../app/node_modules/ffmpeg-static/ffmpeg"
p = subprocess.Popen([FF, "-v", "error", "-ss", str(start), "-i", clip, "-t", str(DUR), "-vf", f"fps={FPS},scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
tracks, active, events = [], [], []
n = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    a = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    c = a[y0:y1, x0:x1].astype(np.int16); r, g, b = c[..., 0], c[..., 1], c[..., 2]
    # yellow incl. pale/blurred: red & green well above blue
    yel = (r > 140) & (g > 140) & (b < 0.75 * g) & (r >= 0.8 * g)
    lab, m = ndimage.label(yel)
    blobs = []
    if m:
        idx = np.arange(1, m + 1); areas = ndimage.sum(yel, lab, idx); keep = areas >= 10
        if keep.any():
            for (cy, cx), ar in zip(ndimage.center_of_mass(yel, lab, idx[keep]), areas[keep]):
                blobs.append((float(cx) + x0, float(cy) + y0, int(ar)))
    used = set()
    for tr in active:
        px, py = tr["pts"][-1][:2]
        if len(tr["pts"]) > 1:
            qx, qy = tr["pts"][-2][:2]; px, py = px + 0.7 * (px - qx), py + 0.7 * (py - qy)
        best, bj = 24, -1
        for j, (bx, by, ar) in enumerate(blobs):
            if j in used: continue
            d = ((bx - px) ** 2 + (by - py) ** 2) ** 0.5
            if d < best: best, bj = d, j
        if bj >= 0:
            used.add(bj); bx, by, ar = blobs[bj]
            ly = tr["pts"][-1][1]
            if ly < RIM <= by and tr.get("above", 0) >= 2:     # came from above the rim, now below it
                tr["cross"] = n
            if by < RIM: tr["above"] = tr.get("above", 0) + 1
            tr["pts"].append((bx, by, n)); tr["miss"] = 0
        else: tr["miss"] += 1
    still = []
    for tr in active:
        if tr["miss"] > 2 or n - tr["pts"][-1][2] > 2:
            if "cross" in tr:
                # still inside after crossing (did not leave again within 0.5 s)
                after = [q for q in tr["pts"] if q[2] > tr["cross"]]
                stayed = all(q[1] >= RIM - 4 for q in after)
                if stayed: events.append({"t": round(tr["cross"] / FPS, 2), "x": int(tr["pts"][-1][0]), "n": len(tr["pts"])})
            tracks.append(tr)
        else: still.append(tr)
    active = still
    for j, (bx, by, ar) in enumerate(blobs):
        if j not in used: active.append({"pts": [(bx, by, n)], "miss": 0, "above": 1 if by < RIM else 0})
    n += 1
p.wait()
json.dump({"fps": FPS, "events": events}, open(out, "w"))
print(f"{n} frames, {len(events)} rim crossings → {out}", file=sys.stderr)
