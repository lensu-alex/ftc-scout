"""Dev: pre-label training frames with a large open-vocabulary detector (YOLO-World).
Writes YOLO-format labels to dataset/yolo/{images,labels}/{train,val} and review sheets to debug/prelabel/.
Classes: 0 robot, 1 pollen (yellow), 2 nectar_red, 3 nectar_blue. Hives stay unlabelled (= background)."""
import glob, json, os, random, shutil, cv2, numpy as np
from ultralytics import YOLOWorld

PROMPTS = ["toy car", "yellow ball", "red ball", "blue ball", "house", "person"]  # house/person = decoys
CLASS_OF = {0: 0, 1: 1, 2: 2, 3: 3}
NAMES = ["robot", "pollen", "nectar_red", "nectar_blue"]
COL = [(0, 255, 0), (0, 255, 255), (0, 0, 255), (255, 128, 0), (255, 0, 255)]

def robot_or_hive(im, b):
    """The open-vocabulary model calls hives "toy car" too. Hives are thin red/blue outlines
    around see-through panels (colourful, almost no dark pixels); robots have dark parts."""
    x0, y0, x1, y1 = [int(v) for v in b]
    hsv = cv2.cvtColor(im[max(0, y0):y1, max(0, x0):x1], cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    sat = (s > 120) & (v > 80)
    colour = max((sat & ((h <= 8) | (h >= 165))).mean(), (sat & (h >= 100) & (h <= 125)).mean())
    dark = (v < 70).mean()
    if colour >= 0.12 and dark < 0.12: return "hive"
    if colour < 0.12 or dark >= 0.2: return "robot"
    return "unclear"

model = YOLOWorld("models/yolov8x-worldv2.pt")
model.set_classes(PROMPTS)
# the previously trained small detector adds its confident detections (self-training)
import sys
STUDENT = sys.argv[1] if len(sys.argv) > 1 else None
student = None
if STUDENT:
    from ultralytics import YOLO
    student = YOLO(STUDENT)
VAL_STREAMS = {"USOHCON", "USIANON"}  # whole events held out: tests generalisation to new events
overlay = json.load(open("dataset/train_overlay.json"))

def iou(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter / max(1e-6, min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1])))

def ball_colour_ok(im, b, cls):
    x0, y0, x1, y1 = [int(v) for v in b]
    patch = im[max(0, y0):y1, max(0, x0):x1]
    if patch.size == 0: return False
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    h, s, v = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    sat = (s > 90) & (v > 70)
    if cls == 1: m = sat & (h >= 18) & (h <= 40)
    elif cls == 2: m = sat & ((h <= 8) | (h >= 165))
    else: m = sat & (h >= 95) & (h <= 130)
    return m.mean() > 0.2

def run(img, imgsz=1280):
    r = model.predict(img, conf=0.05, imgsz=imgsz, verbose=False, device="mps")[0]
    return list(zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()))

def teacher(im):
    """Full frame + mirrored frame + 2x2 zoomed tiles (balls are only ~10 px at full size)."""
    H, W = im.shape[:2]
    dets = run(im)
    for b, c, s in run(cv2.flip(im, 1)):
        dets.append((np.array([W - b[2], b[1], W - b[0], b[3]]), c, s))
    th, tw = int(H * 0.6), int(W * 0.6)
    for ty in (0, H - th):
        for tx in (0, W - tw):
            for b, c, s in run(im[ty:ty + th, tx:tx + tw], 960):
                if c in (1, 2, 3):  # tiles only add balls
                    dets.append((b + np.array([tx, ty, tx, ty]), c, s))
    if student is not None:
        r = student.predict(im, conf=0.4, imgsz=640, verbose=False, device="mps")[0]
        for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()):
            dets.append((b, int(c), float(s) * 0.8))  # student classes 0..3 = prompt indices 0..3
    return fuse(dets)

def fuse(dets, thr=0.55):
    """Merge boxes of the same class from the different passes (score-weighted average)."""
    dets = sorted(dets, key=lambda d: -d[2])
    groups = []
    for b, c, s in dets:
        for g in groups:
            if g["c"] == c and iou(b, g["b"]) > thr:
                g["items"].append((b, s)); w = np.array([x[1] for x in g["items"]])
                g["b"] = (np.array([x[0] for x in g["items"]]) * w[:, None]).sum(0) / w.sum()
                break
        else:
            groups.append({"c": c, "b": b, "items": [(b, s)]})
    # more passes agreeing = more confident
    return [(g["b"], g["c"], min(1.0, max(x[1] for x in g["items"]) * (1 + 0.15 * (len(g["items"]) - 1)))) for g in groups]

def label(path):
    im = cv2.imread(path)
    H, W = im.shape[:2]
    masks = overlay.get(os.path.basename(path), [])
    dets = teacher(im)
    decoys = [b for b, c, s in dets if c == 4 and s > 0.05]
    out = []
    for b, c, s in dets:
        if c not in CLASS_OF: continue
        if any(iou(b, m) > 0.3 for m in masks): continue
        w, h = b[2] - b[0], b[3] - b[1]
        if c == 0:
            if s < 0.06 or w * h > 0.08 * W * H or w * h < 400: continue
            if any(iou(b, d) > 0.5 for d in decoys): continue
        else:
            if s < 0.1 or w * h > 0.004 * W * H or not (0.5 < w / max(h, 1) < 2): continue
            if not ball_colour_ok(im, b, c): continue
        cl = CLASS_OF[c]
        if cl == 0:
            kind = robot_or_hive(im, b)
            if kind == "hive": continue  # not labelled: the detector learns hives are background
            cl = 0 if kind == "robot" else -1  # -1: unclear, blanked out of the image
        out.append((cl, b, s))
    # one label per object: drop lower-score duplicates of the same class
    keep = []
    for cl, b, s in sorted(out, key=lambda x: -x[2]):
        if not any(cl == k[0] and iou(b, k[1]) > 0.6 for k in keep): keep.append((cl, b, s))
    return im, keep

files = sorted(glob.glob("dataset/train_raw/*.jpg"))
random.seed(1); random.shuffle(files)
root = "dataset/yolo"
shutil.rmtree(root, ignore_errors=True)
streams = sorted({os.path.basename(f).split("_")[0] for f in files})
# pass 1: detect in every frame
results = {f: label(f) for f in files}
# pass 2: within one match the camera is fixed, so anything that never moves is scenery
# (hive, flower posts, signs), not a robot or a ball in play
group = lambda f: "_".join(os.path.basename(f).split("_")[:2])
groups = {}
for f in files: groups.setdefault(group(f), []).append(f)
dropped = [0, 0]
for g, fs in groups.items():
    for f in fs:
        im, keep = results[f]
        out = []
        for cl, b, s in keep:
            same = sum(1 for o in fs if o != f and any(k[0] == cl and iou(b, k[1]) > 0.7 for k in results[o][1]))
            limit = 0.5 if cl == 0 else 0.85
            if len(fs) >= 4 and same >= limit * (len(fs) - 1): dropped[cl > 0] += 1; continue
            out.append((cl, b, s))
        results[f] = (im, out)
print("static boxes dropped: robots", dropped[0], "balls", dropped[1])

tiles, counts = [], [0] * 4
for i, f in enumerate(files):
    split = "val" if os.path.basename(f).split("_")[0] in VAL_STREAMS else "train"
    os.makedirs(f"{root}/images/{split}", exist_ok=True); os.makedirs(f"{root}/labels/{split}", exist_ok=True)
    im, keep = results[f]
    H, W = im.shape[:2]
    # unclear boxes are greyed out so the detector is never taught a wrong answer
    img = im.copy()
    for cl, b, s in keep:
        if cl < 0:
            x0, y0, x1, y1 = [int(v) for v in b]; img[max(0, y0):y1, max(0, x0):x1] = 114
    keep = [k for k in keep if k[0] >= 0]
    cv2.imwrite(f"{root}/images/{split}/{os.path.basename(f)}", img)
    with open(f"{root}/labels/{split}/{os.path.basename(f)[:-4]}.txt", "w") as fh:
        for cl, b, s in keep:
            counts[cl] += 1
            fh.write(f"{cl} {(b[0]+b[2])/2/W:.6f} {(b[1]+b[3])/2/H:.6f} {(b[2]-b[0])/W:.6f} {(b[3]-b[1])/H:.6f}\n")
    vis = img.copy()
    for cl, b, s in keep:
        x0, y0, x1, y1 = b.astype(int); cv2.rectangle(vis, (x0, y0), (x1, y1), COL[cl], 2)
    cv2.putText(vis, os.path.basename(f), (10, 30), 0, 1, (255, 255, 255), 2)
    tiles.append(cv2.resize(vis, (640, 360)))
for k in range(0, len(tiles), 12):
    t = tiles[k:k+12]
    while len(t) % 3: t.append(np.zeros_like(t[0]))
    cv2.imwrite(f"debug/prelabel/review_{k//12:02d}.jpg", np.vstack([np.hstack(t[i:i+3]) for i in range(0, len(t), 3)]))
open(f"{root}/data.yaml", "w").write(f"path: {os.path.abspath(root)}\ntrain: images/train\nval: images/val\nnames: {NAMES}\n")
print(len(files), "frames", dict(zip(NAMES, counts)), "streams", len(streams), "val =", VAL_STREAMS)
