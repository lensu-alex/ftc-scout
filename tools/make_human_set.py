"""Dev: dataset with the hand-corrected robot boxes (dataset/human, from label_server.py) applied.
usage: make_human_set.py <auto dataset> <out>   e.g. dataset/yolo3 dataset/yolo4
Checked frames use the original picture (nothing greyed) and the person's robot boxes; balls stay
automatic. Checked training frames are included twice (they are the best labels we have)."""
import glob, os, shutil, sys
src, out = sys.argv[1], sys.argv[2]
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(src, out)
n = 0
for h in glob.glob("dataset/human/*.txt"):
    name = os.path.basename(h)[:-4]
    lab = glob.glob(f"{out}/labels/*/{name}.txt")
    if not lab: continue
    split = lab[0].split("/")[-2]
    balls = [l for l in open(lab[0]) if not l.startswith("0 ")]
    robots = [l if l.endswith("\n") else l + "\n" for l in open(h) if l.strip()]
    copies = [name] + ([f"{name}_h2"] if split == "train" else [])
    for c in copies:
        open(f"{out}/labels/{split}/{c}.txt", "w").writelines(robots + balls)
        shutil.copy(f"dataset/train_raw/{name}.jpg", f"{out}/images/{split}/{c}.jpg")
    n += 1
y = open(f"{out}/data.yaml").read().replace(os.path.abspath(src), os.path.abspath(out))
open(f"{out}/data.yaml", "w").write(y)
# the held-out frames a person checked: the honest test set
os.makedirs(f"{out}_humanval/images/val", exist_ok=True); os.makedirs(f"{out}_humanval/labels/val", exist_ok=True)
k = 0
for lab in glob.glob(f"{out}/labels/val/*.txt"):
    name = os.path.basename(lab)[:-4]
    if os.path.exists(f"dataset/human/{name}.txt"):
        shutil.copy(lab, f"{out}_humanval/labels/val/"); shutil.copy(f"{out}/images/val/{name}.jpg", f"{out}_humanval/images/val/"); k += 1
open(f"{out}_humanval/data.yaml", "w").write(y.replace(os.path.abspath(out), os.path.abspath(out + "_humanval")).replace("train: images/train", "train: images/val"))
print(n, "frames corrected,", k, "of them in the held-out events")
