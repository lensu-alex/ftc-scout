"""Dev tool: frames every <step>s from <start> for <dur>s of a dataset stream, as a contact sheet."""
import json, sys, subprocess, os, cv2, numpy as np, yt_dlp, imageio_ffmpeg
name, start, dur, step = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
meta = json.load(open(f"dataset/{name}/meta.json"))
with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as y:
    d = y.extract_info(f"https://www.youtube.com/watch?v={meta['id']}", download=False)
url = [f for f in d["formats"] if f["format_id"] == meta["format"]][0]["url"]
os.makedirs(f"dataset/{name}/seq", exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
out = f"dataset/{name}/seq/s{int(start)}_%04d.jpg"
subprocess.run([FF, "-loglevel", "error", "-y", "-ss", str(start), "-i", url, "-t", str(dur), "-vf", f"fps=1/{step}", out], timeout=600)
files = sorted(f for f in os.listdir(f"dataset/{name}/seq") if f.startswith(f"s{int(start)}_"))
tiles = []
for i, f in enumerate(files):
    im = cv2.resize(cv2.imread(f"dataset/{name}/seq/{f}"), (480, 270))
    t = start + i * step
    cv2.putText(im, f"{int(t)//60}:{int(t)%60:02d}", (8, 22), 0, 0.7, (0, 255, 255), 2); tiles.append(im)
while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(f"dataset/{name}/seq_{int(start)}.jpg", np.vstack([np.hstack(tiles[i:i+4]) for i in range(0, len(tiles), 4)]))
print(len(files))
