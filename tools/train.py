"""Dev: train one detector configuration.  usage: train.py <name> <base.pt> <imgsz> [epochs]
Augmentation is tuned for event streams: lighting/saturation vary a lot between venues, but hue
must barely move (it is what separates yellow pollen from red/blue nectar)."""
import os, sys
import albumentations as A
import torch
from ultralytics import YOLO

# GPU on whichever laptop runs this: CUDA (Linux RTX 3050), MPS (Mac), else CPU; FTC_DEVICE overrides
DEVICE = os.environ.get("FTC_DEVICE") or ("cuda:0" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")

# what live streams do to a picture: heavy compression, motion blur, low resolution, noise
STREAM_AUG = [
    A.ImageCompression(quality_range=(30, 90), p=0.4),
    A.OneOf([A.MotionBlur(blur_limit=(3, 9)), A.GaussianBlur(blur_limit=(3, 5))], p=0.25),
    A.Downscale(scale_range=(0.45, 0.85), p=0.3),
    A.GaussNoise(std_range=(0.01, 0.05), p=0.15),
    A.CLAHE(p=0.05),
]
name, base, imgsz = sys.argv[1], sys.argv[2], int(sys.argv[3])
epochs = int(sys.argv[4]) if len(sys.argv) > 4 else 120
def portable_yaml(folder):
    """data.yaml files carry the absolute path of the machine that made them; point them at their own folder."""
    yml = os.path.join(folder, "data.yaml")
    lines = open(yml).read().splitlines()
    fixed = [f"path: {os.path.abspath(folder)}" if l.startswith("path:") else l for l in lines]
    if fixed == lines:
        return yml
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", f"{os.path.basename(os.path.normpath(folder))}.data.yaml")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write("\n".join(fixed) + "\n")
    return out

YOLO(base).train(
    data=portable_yaml(os.environ.get("FTC_DATA", "dataset/yolo")), imgsz=imgsz, epochs=epochs, batch=int(os.environ.get("FTC_BATCH", 16)), device=DEVICE,
    project=os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs"), name=name, exist_ok=True, patience=40, plots=False, verbose=False,
    hsv_h=0.005, hsv_s=0.6, hsv_v=0.45, degrees=0, translate=0.1, scale=0.5, fliplr=0.5,
    mosaic=1.0, mixup=0.1, close_mosaic=10, cos_lr=True, workers=8, cache="ram", augmentations=STREAM_AUG,
)
