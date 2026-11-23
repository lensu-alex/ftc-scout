"""Hive finder v2: the red hive outline is found reliably (pure red tubes are rare in the picture); the blue hive
stands next to it with the same size. Blue is placed on whichever side has more blue-tube pixels in a box of the
same size, and refined to the bounding box of blue tube pixels inside that box.
usage: .venv/bin/python find_hive2.py <frame.png> [out.png]"""
import sys, json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

def tubes(m, W):
    m = m & ~ndimage.binary_opening(m, structure=np.ones((13, 13), bool))
    return m

def find_hive(a):
    H, W = a.shape[:2]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 110) & (g < 0.45 * r) & (b < 0.6 * r)
    blue = (b > 100) & (r < 0.55 * b) & (g < 0.8 * b) & (b - r > 70)
    mask = np.zeros((H, W), bool); mask[: int(0.8 * H), int(0.15 * W): int(0.85 * W)] = True
    rt = tubes(red & mask, W)
    lab, n = ndimage.label(ndimage.binary_dilation(rt, iterations=1))
    comps = []
    for i, s in enumerate(ndimage.find_objects(lab), 1):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start; area = int((lab[s] == i).sum())
        if max(h, w) < 18 or max(h, w) > 0.4 * W or area < 60: continue
        comps.append([s[1].start, s[0].start, s[1].stop, s[0].stop, area])
    if not comps: return {}
    # group red components that touch (pad 25% of size), take the biggest group near the middle
    groups = []
    for c in sorted(comps, key=lambda c: -c[4]):
        for gr in groups:
            pad = 0.3 * max(gr[2] - gr[0], gr[3] - gr[1], 40)
            if c[2] > gr[0] - pad and c[0] < gr[2] + pad and c[3] > gr[1] - pad and c[1] < gr[3] + pad:
                gr[0], gr[1], gr[2], gr[3], gr[4] = min(gr[0], c[0]), min(gr[1], c[1]), max(gr[2], c[2]), max(gr[3], c[3]), gr[4] + c[4]; break
        else: groups.append(list(c))
    groups = [gr for gr in groups if max(gr[2] - gr[0], gr[3] - gr[1]) <= 0.35 * W]
    if not groups: return {}
    rg = max(groups, key=lambda gr: gr[4] / (1 + abs((gr[0] + gr[2]) / 2 - W / 2) / (0.2 * W)))
    rw, rh = rg[2] - rg[0], rg[3] - rg[1]
    bt = tubes(blue & mask, W)
    best = None
    # candidate blue boxes: same size, to the left / right / above / below with a gap of 0..0.6 hive sizes
    for side in ("L", "R", "U", "D"):
        for gap in np.linspace(0, 0.6, 7):
            if side == "L": bx0, by0 = rg[0] - rw - gap * rw, rg[1]
            elif side == "R": bx0, by0 = rg[2] + gap * rw, rg[1]
            elif side == "U": bx0, by0 = rg[0], rg[1] - rh - gap * rh
            else: bx0, by0 = rg[0], rg[3] + gap * rh
            bx1, by1 = bx0 + rw, by0 + rh
            x0, y0, x1, y1 = int(max(0, bx0)), int(max(0, by0)), int(min(W, bx1)), int(min(H, by1))
            if x1 <= x0 or y1 <= y0: continue
            cnt = int(bt[y0:y1, x0:x1].sum())
            if best is None or cnt > best[0]: best = (cnt, x0, y0, x1, y1)
    if not best or best[0] < 0.1 * rg[4]: return {"red": rg[:4]}
    cnt, x0, y0, x1, y1 = best
    ys, xs = np.nonzero(bt[y0:y1, x0:x1])
    bb = [int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0 + 1, int(ys.max()) + y0 + 1]
    return {"red": rg[:4], "blue": bb}

if __name__ == "__main__":
    im = Image.open(sys.argv[1]).convert("RGB"); out = find_hive(np.asarray(im).astype(np.int16)); print(json.dumps(out))
    if len(sys.argv) > 2:
        d = ImageDraw.Draw(im)
        for name, bx in out.items(): d.rectangle(bx, outline=(255, 0, 0) if name == "red" else (0, 128, 255), width=3)
        im.save(sys.argv[2])
