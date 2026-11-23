import glob, cv2, numpy as np, os
rows = []
for lf in glob.glob("dataset/yolo/labels/*/*.txt"):
    imf = lf.replace("labels", "images").replace(".txt", ".jpg")
    im = cv2.imread(imf); H, W = im.shape[:2]
    for line in open(lf):
        c, cx, cy, w, h = map(float, line.split())
        if c != 0: continue
        x0, y0, x1, y1 = int((cx-w/2)*W), int((cy-h/2)*H), int((cx+w/2)*W), int((cy+h/2)*H)
        p = im[max(0,y0):y1, max(0,x0):x1]
        hsv = cv2.cvtColor(p, cv2.COLOR_BGR2HSV); hh, s, v = hsv[...,0], hsv[...,1], hsv[...,2]
        sat = (s > 120) & (v > 80)
        red = sat & ((hh <= 8) | (hh >= 165)); blue = sat & (hh >= 100) & (hh <= 125)
        dark = (v < 70).mean()
        rows.append((max(red.mean(), blue.mean()), imf, (x0, y0, x1, y1), dark))
rows.sort(key=lambda r: -r[0])
print([round(r[0], 3) for r in rows[:40]])
tiles = []
for f, imf, (x0, y0, x1, y1), dark in rows[:40]:
    im = cv2.imread(imf); c = cv2.resize(im[max(0,y0):y1, max(0,x0):x1], (160, 120))
    cv2.putText(c, f"{f:.2f} d{dark:.2f}", (3, 15), 0, 0.5, (0, 255, 255), 2); tiles.append(c)
cv2.imwrite("debug/prelabel/colourful_robots.jpg", np.vstack([np.hstack(tiles[i:i+8]) for i in range(0, 40, 8)]))
