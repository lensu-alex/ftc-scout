"""Experiment: find the hive (red + blue tube outlines, side by side, at the field centre) in one frame.
usage: .venv/bin/python find_hive.py <frame.png> [out.png]  → {"red":[x0,y0,x1,y1],"blue":[...]} or {}"""
import sys, json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

def tube_components(m, W):
    """Thin coloured structures (tubes are 3-10 px wide; a wall or shirt is wide and is removed)."""
    m = m & ~ndimage.binary_opening(m, structure=np.ones((13, 13), bool))
    lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=1))
    comps = []
    for i, s in enumerate(ndimage.find_objects(lab), 1):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        area = int((lab[s] == i).sum())
        if max(h, w) < 18 or max(h, w) > 0.4 * W or area < 60: continue
        comps.append([s[1].start, s[0].start, s[1].stop, s[0].stop, area])
    return comps

def groups_of(comps):
    groups = []
    for c in sorted(comps, key=lambda c: -c[4]):
        for gr in groups:
            pad = 0.25 * max(gr[2] - gr[0], gr[3] - gr[1], 40)
            if c[2] > gr[0] - pad and c[0] < gr[2] + pad and c[3] > gr[1] - pad and c[1] < gr[3] + pad:
                gr[0], gr[1], gr[2], gr[3], gr[4] = min(gr[0], c[0]), min(gr[1], c[1]), max(gr[2], c[2]), max(gr[3], c[3]), gr[4] + c[4]
                break
        else: groups.append(list(c))
    return groups

def find_hive(a):
    H, W = a.shape[:2]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 110) & (g < 0.45 * r) & (b < 0.6 * r)
    blue = (b > 100) & (r < 0.55 * b) & (g < 0.8 * b) & (b - r > 70)
    mask = np.zeros((H, W), bool); mask[: int(0.8 * H), int(0.15 * W): int(0.85 * W)] = True
    R = [gr for gr in groups_of(tube_components(red & mask, W)) if max(gr[2] - gr[0], gr[3] - gr[1]) <= 0.35 * W]
    Bc = tube_components(blue & mask, W)
    best, out = 0, {}
    for rg in sorted(R, key=lambda c: -c[4])[:3]:
        rs = max(rg[2] - rg[0], rg[3] - rg[1]); cx, cy = (rg[0] + rg[2]) / 2, (rg[1] + rg[3]) / 2
        # the blue hive stands next to the red one: blue tubes within ~2 hive sizes, not inside the red box
        near = [c for c in Bc if abs((c[0] + c[2]) / 2 - cx) < 2.2 * rs and abs((c[1] + c[3]) / 2 - cy) < 2.2 * rs
                and max(c[2] - c[0], c[3] - c[1]) <= 1.4 * rs]
        if not near: continue
        bgs = groups_of(near)
        for bg in bgs:
            bs = max(bg[2] - bg[0], bg[3] - bg[1]); sim = min(rs, bs) / max(rs, bs)
            if sim < 0.4: continue
            gap = max(0, max(rg[0], bg[0]) - min(rg[2], bg[2]), max(rg[1], bg[1]) - min(rg[3], bg[3]))
            score = (rg[4] + bg[4]) * sim / (1 + gap / rs)
            if score > best: best, out = score, {"red": rg[:4], "blue": bg[:4]}
    return out

if __name__ == "__main__":
    im = Image.open(sys.argv[1]).convert("RGB"); a = np.asarray(im).astype(np.int16)
    out = find_hive(a); print(json.dumps(out))
    if len(sys.argv) > 2:
        d = ImageDraw.Draw(im)
        for name, bx in out.items(): d.rectangle(bx, outline=(255, 0, 0) if name == "red" else (0, 128, 255), width=3)
        im.save(sys.argv[2])
