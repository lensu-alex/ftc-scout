"""Dev: try an open-vocabulary detector on sample frames and draw a contact sheet."""
import glob, cv2, numpy as np, sys
from ultralytics import YOLOWorld
model = YOLOWorld(sys.argv[1] if len(sys.argv) > 1 else "yolov8x-worldv2.pt")
classes = ["robot", "yellow ball", "red ball", "blue ball"]
model.set_classes(classes)
colors = [(0, 255, 0), (0, 255, 255), (0, 0, 255), (255, 128, 0)]
files = sorted(glob.glob("dataset/train_raw/*_12.jpg"))[:8] + sorted(glob.glob("dataset/train_raw/*_85.jpg"))[:4]
tiles = []
for f in files:
    im = cv2.imread(f)
    r = model.predict(im, conf=0.08, imgsz=1280, verbose=False, device="mps")[0]
    for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()):
        x0, y0, x1, y1 = b.astype(int)
        cv2.rectangle(im, (x0, y0), (x1, y1), colors[c], 2)
        if c == 0: cv2.putText(im, f"{s:.2f}", (x0, y0 - 4), 0, 0.6, colors[c], 2)
    cv2.putText(im, f.split("/")[-1], (10, 30), 0, 1, (255, 255, 255), 2)
    tiles.append(cv2.resize(im, (640, 360)))
while len(tiles) % 3: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite("debug/prelabel/world.jpg", np.vstack([np.hstack(tiles[i:i+3]) for i in range(0, len(tiles), 3)]))
