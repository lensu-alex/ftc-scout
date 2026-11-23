import cv2, numpy as np
from ultralytics import YOLOWorld
m = YOLOWorld("models/yolov8x-worldv2.pt")
P = ["birdhouse", "cage", "basket", "lantern", "shelf", "transparent box", "toy car"]
m.set_classes(P)
cols = [(255,0,255),(0,255,255),(255,255,0),(0,128,255),(255,0,0),(128,128,255),(0,255,0)]
fs = ["USMICOQ_Q21_25","USOHCON_Q5_25","USAZFLQ_Q5_150","USAZFLQ_Q9_50","NLRON_Q17_70","USCALALCS2_Q5_12"]
tiles = []
for f in fs:
    im = cv2.imread(f"dataset/train_raw/{f}.jpg")
    r = m.predict(im, conf=0.05, imgsz=1280, verbose=False, device="mps")[0]
    for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()):
        x0,y0,x1,y1 = b.astype(int); cv2.rectangle(im,(x0,y0),(x1,y1),cols[c],2); cv2.putText(im,f"{P[c][:5]} {s:.2f}",(x0,y0-3),0,0.5,cols[c],2)
    tiles.append(cv2.resize(im,(640,360)))
cv2.imwrite("debug/prelabel/hive_prompts.jpg", np.vstack([np.hstack(tiles[i:i+3]) for i in range(0,6,3)]))
