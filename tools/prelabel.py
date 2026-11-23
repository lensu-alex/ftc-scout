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
STUDENT_SIZE = 832 if STUDENT and "832" in STUDENT else 640
WEAK = 10  # a class of its own, so fuse() never merges it into a confident robot
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
        r = student.predict(im, conf=0.08, imgsz=STUDENT_SIZE, verbose=False, device="mps")[0]
        for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()):
            if s >= 0.4: dets.append((b, int(c), float(s) * 0.8))  # student classes 0..3 = prompt indices 0..3
            elif c == 0: dets.append((b, WEAK, float(s)))      # weak robot: only with motion (see label())
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

MW, MH = 160, 90
def small(im): return cv2.resize(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), (MW, MH), interpolation=cv2.INTER_AREA).astype(np.int16)

def motion_map(f, fs):
    """Within one match the camera is fixed: the median of the other frames of the same view is
    the field without the (moving) robots. Returns a foreground mask at 160x90, or None."""
    me = small(cv2.imread(f))
    same = []
    for o in fs:
        if o == f: continue
        g = small(cv2.imread(o))
        if np.corrcoef(me.ravel(), g.ravel())[0, 1] > 0.8: same.append(g)  # same camera view
    if len(same) < 4: return None
    fg = (np.abs(me - np.median(np.stack(same), axis=0)) > 28).astype(np.uint8)
    if fg.mean() > 0.3: return None  # camera moved or lighting changed: no usable background
    return cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

def moving(fg, b, W, H):
    if fg is None: return 0.0
    x0, x1 = int((b[0] + 0.1 * (b[2] - b[0])) / W * MW), int(np.ceil((b[2] - 0.1 * (b[2] - b[0])) / W * MW))
    y0, y1 = int((b[1] + 0.1 * (b[3] - b[1])) / H * MH), int(np.ceil((b[3] - 0.1 * (b[3] - b[1])) / H * MH))
    patch = fg[max(0, y0):y1, max(0, x0):x1]
    return float(patch.mean()) if patch.size else 0.0

def label(path, fg=None):
    im = cv2.imread(path)
    H, W = im.shape[:2]
    masks = overlay.get(os.path.basename(path), [])
    dets = teacher(im)
    decoys = [b for b, c, s in dets if c == 4 and s > 0.05]
    out = []
    for b, c, s in dets:
        if c == WEAK:
            # a weak robot guess counts only over something that moved, on the field, and robot-like
            w, h = b[2] - b[0], b[3] - b[1]
            if moving(fg, b, W, H) < 0.4 or w * h > 0.08 * W * H or w * h < 400: continue
            if any(iou(b, m) > 0.3 for m in masks) or any(iou(b, d) > 0.5 for d in decoys): continue
            if robot_or_hive(im, b) != "robot": continue
            if any(c2 == 0 and iou(b, b2) > 0.5 for b2, c2, s2 in dets): continue  # already a robot
            out.append((0, b, 0.12, 1.0)); continue  # (0.12: still has to pass the on-field check)
        if c not in CLASS_OF: continue
        if any(iou(b, m) > 0.3 for m in masks): continue
        w, h = b[2] - b[0], b[3] - b[1]
        if c == 0:
            if w * h > 0.08 * W * H or w * h < 400: continue
            # weak boxes count when they sit on something that moved (robots on cameras the
            # models find hard: dark, blurred, behind the field walls)
            mv = moving(fg, b, W, H)
            if s < 0.06: continue
            if any(iou(b, d) > 0.5 for d in decoys): continue
        else:
            if s < 0.1 or w * h > 0.004 * W * H or not (0.5 < w / max(h, 1) < 2): continue
            if not ball_colour_ok(im, b, c): continue
        cl = CLASS_OF[c]
        if cl == 0:
            kind = robot_or_hive(im, b)
            if kind == "hive": continue  # not labelled: the detector learns hives are background
            cl = 0 if kind == "robot" else -1  # -1: unclear, blanked out of the image
        out.append((cl, b, s, mv if c == 0 else 0.0))
    # one label per object: drop lower-score duplicates of the same class
    keep = []
    for cl, b, s, mv in sorted(out, key=lambda x: -x[2]):
        if not any(cl == k[0] and iou(b, k[1]) > 0.6 for k in keep): keep.append((cl, b, s, mv))
    return im, keep

files = sorted(glob.glob("dataset/train_raw/*.jpg"))
ONLY = os.environ.get("PRELABEL_ONLY")  # dev: a few events, e.g. "USORSFM1,NLRON"
if ONLY: files = [f for f in files if os.path.basename(f).split("_")[0] in ONLY.split(",")]
random.seed(1); random.shuffle(files)
root = os.environ.get("PRELABEL_ROOT", "dataset/yolo")
shutil.rmtree(root, ignore_errors=True)
streams = sorted({os.path.basename(f).split("_")[0] for f in files})
group = lambda f: "_".join(os.path.basename(f).split("_")[:2])
groups = {}
for f in files: groups.setdefault(group(f), []).append(f)
# pass 1: detect in every frame, with what moved compared to the rest of its match
fgs = {f: motion_map(f, groups[group(f)]) for f in files}
print("frames with a motion map:", sum(v is not None for v in fgs.values()), "/", len(files))
results = {f: label(f, fgs[f]) for f in files}

# the field: balls lie on it, so the outline of every ball seen in a match marks it (any camera)
def field_of(fs):
    pts = np.array([[(k[1][0] + k[1][2]) / 2, k[1][3]] for o in fs for k in results[o][1] if k[0] > 0], np.float32)
    if len(pts) < 20: return None
    return cv2.convexHull(pts)
fields = {g: field_of(fs) for g, fs in groups.items()}
def on_field(f, b, margin):
    hull = fields[group(f)]
    if hull is None: return True
    return cv2.pointPolygonTest(hull, (float((b[0] + b[2]) / 2), float(b[3])), True) > -margin
# weak (motion-confirmed) robots must stand on the field
for f in files:
    im, keep = results[f]
    results[f] = (im, [k for k in keep if k[0] != 0 or k[2] >= 0.15 or on_field(f, k[1], 0.02 * im.shape[1])])
# pass 2: within one match the camera is fixed, so anything that never moves is scenery
# (hive, flower posts, signs), not a robot or a ball in play
dropped = [0, 0]
for g, fs in groups.items():
    for f in fs:
        im, keep = results[f]
        out = []
        for cl, b, s, mv in keep:
            same = sum(1 for o in fs if o != f and any(k[0] == cl and iou(b, k[1]) > 0.7 for k in results[o][1]))
            limit = 0.5 if cl == 0 else 0.85
            # (a robot that moved in this frame is not scenery, even if it parks for the rest)
            if len(fs) >= 4 and same >= limit * (len(fs) - 1) and mv < 0.3: dropped[cl > 0] += 1; continue
            out.append((cl, b, s, mv))
        results[f] = (im, out)
print("static boxes dropped: robots", dropped[0], "balls", dropped[1])

tiles, counts, greyed, humans = [], [0] * 4, [0], [0]
for i, f in enumerate(files):
    split = "val" if os.path.basename(f).split("_")[0] in VAL_STREAMS else "train"
    os.makedirs(f"{root}/images/{split}", exist_ok=True); os.makedirs(f"{root}/labels/{split}", exist_ok=True)
    im, keep = results[f]
    H, W = im.shape[:2]
    # frames a person checked (label_server.py): their robot boxes replace the automatic ones
    human = f"dataset/human/{os.path.basename(f)[:-4]}.txt"
    if os.path.exists(human):
        hb = [list(map(float, l.split()[1:])) for l in open(human) if l.strip()]
        keep = [k for k in keep if k[0] > 0] + [(0, np.array([(x - w / 2) * W, (y - h / 2) * H, (x + w / 2) * W, (y + h / 2) * H]), 1.0, 0.0) for x, y, w, h in hb]
        fgs[f] = None  # nothing left unexplained
        humans[0] += 1
    # unclear boxes are greyed out so the detector is never taught a wrong answer
    img = im.copy()
    for cl, b, s, mv in keep:
        if cl < 0:
            x0, y0, x1, y1 = [int(v) for v in b]; img[max(0, y0):y1, max(0, x0):x1] = 114
    keep = [k for k in keep if k[0] >= 0]
    # robot-sized moving things nobody labelled might be a missed robot: greyed out too, so
    # the detector is never taught that a robot is background
    fg = fgs[f]
    if fg is not None:
        n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)))
        sx, sy = W / MW, H / MH
        known = np.zeros((MH, MW), np.uint8)  # what the labels already explain
        for k in keep:
            x0, y0, x1, y1 = k[1]
            known[int(y0 / sy):int(np.ceil(y1 / sy)), int(x0 / sx):int(np.ceil(x1 / sx))] = 1
        sizes = [(k[1][2] - k[1][0]) * (k[1][3] - k[1][1]) for o in groups[group(f)] for k in results[o][1] if k[0] == 0]
        robot = float(np.median(sizes)) if len(sizes) >= 3 else 0.01 * W * H
        for i in range(1, n):
            x, y, w, h, a = st[i]
            if a < 12: continue
            b = np.array([x * sx, y * sy, (x + w) * sx, (y + h) * sy])
            # only robot-sized things on the field (people beside it are not a missed robot)
            if not (0.3 * robot <= (b[2] - b[0]) * (b[3] - b[1]) <= 2.5 * robot) or not on_field(f, b, 0): continue
            if any(iou(b, m) > 0.3 for m in overlay.get(os.path.basename(f), [])): continue
            if known[y:y + h, x:x + w][lab[y:y + h, x:x + w] == i].mean() > 0.5: continue
            greyed[0] += 1
            x0, y0, x1, y1 = b.astype(int); img[y0:y1, x0:x1] = 114
    cv2.imwrite(f"{root}/images/{split}/{os.path.basename(f)}", img)
    with open(f"{root}/labels/{split}/{os.path.basename(f)[:-4]}.txt", "w") as fh:
        for cl, b, s, mv in keep:
            counts[cl] += 1
            fh.write(f"{cl} {(b[0]+b[2])/2/W:.6f} {(b[1]+b[3])/2/H:.6f} {(b[2]-b[0])/W:.6f} {(b[3]-b[1])/H:.6f}\n")
    vis = img.copy()
    for cl, b, s, mv in keep:
        x0, y0, x1, y1 = b.astype(int); cv2.rectangle(vis, (x0, y0), (x1, y1), COL[cl], 2)
    cv2.putText(vis, os.path.basename(f), (10, 30), 0, 1, (255, 255, 255), 2)
    tiles.append(cv2.resize(vis, (640, 360)))
for k in range(0, len(tiles), 12):
    t = tiles[k:k+12]
    while len(t) % 3: t.append(np.zeros_like(t[0]))
    cv2.imwrite(f"debug/prelabel/{'try_' if ONLY else ''}review_{k//12:02d}.jpg", np.vstack([np.hstack(t[i:i+3]) for i in range(0, len(t), 3)]))
open(f"{root}/data.yaml", "w").write(f"path: {os.path.abspath(root)}\ntrain: images/train\nval: images/val\nnames: {NAMES}\n")
print("unexplained moving areas greyed out:", greyed[0], "| frames checked by a person:", humans[0])
print(len(files), "frames", dict(zip(NAMES, counts)), "streams", len(streams), "val =", VAL_STREAMS)
