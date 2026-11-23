"""Dev: which text prompt finds FTC robots best? Draws each prompt's boxes in its own colour."""
import glob, cv2, numpy as np
from ultralytics import YOLOWorld
model = YOLOWorld("models/yolov8x-worldv2.pt")
prompts = ["robot", "toy car", "machine", "metal frame", "cart", "remote control car", "box"]
model.set_classes(prompts)
cols = [(0,255,0),(255,0,255),(0,255,255),(255,255,0),(0,128,255),(255,0,0),(128,128,255)]
files = sorted(glob.glob("dataset/train_raw/*_50.jpg"))[::2][:6]
tiles = []
for f in files:
    im = cv2.imread(f)
    r = model.predict(im, conf=0.05, imgsz=1280, verbose=False, device="mps")[0]
    for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()):
        x0, y0, x1, y1 = b.astype(int)
        if (x1-x0)*(y1-y0) > 0.15*im.shape[0]*im.shape[1]: continue
        cv2.rectangle(im, (x0, y0), (x1, y1), cols[c], 2); cv2.putText(im, f"{prompts[c][:6]} {s:.2f}", (x0, y0-3), 0, 0.5, cols[c], 2)
    tiles.append(cv2.resize(im, (640, 360)))
while len(tiles) % 3: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite("debug/prelabel/robot_prompts.jpg", np.vstack([np.hstack(tiles[i:i+3]) for i in range(0, len(tiles), 3)]))
