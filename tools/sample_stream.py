"""Dev tool: pull metadata + evenly spaced frames from a stream into dataset/<name>/ and build a contact sheet."""
import json, subprocess, sys, os
import cv2, numpy as np, yt_dlp, imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()

def info(url):
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as y:
        return y.extract_info(url, download=False)

def pick_format(d, max_h=720):
    fs = [f for f in d["formats"] if f.get("height") and f["height"] <= max_h and f.get("url")
          and f.get("vcodec", "none") != "none" and f.get("protocol") == "https"]
    fs.sort(key=lambda f: (f["height"], (f.get("vcodec") or "").startswith("avc1")))
    return fs[-1]

def grab(src, t, out):
    subprocess.run([FF, "-loglevel", "error", "-y", "-ss", str(t), "-i", src, "-frames:v", "1", out], timeout=120)

def main(name, url, n=12, start=None, end=None):
    d = info(url)
    out = f"dataset/{name}"; os.makedirs(out, exist_ok=True)
    f = pick_format(d)
    json.dump({k: d.get(k) for k in ["id", "title", "description", "duration", "release_timestamp", "was_live", "channel"]}
              | {"format": f["format_id"], "height": f["height"]}, open(f"{out}/meta.json", "w"), indent=1)
    dur = d["duration"]; s = start or dur * 0.05; e = end or dur * 0.95
    ts = [s + (e - s) * i / (n - 1) for i in range(n)]
    tiles = []
    for t in ts:
        p = f"{out}/f{int(t):06d}.jpg"; grab(f["url"], t, p)
        im = cv2.imread(p)
        if im is None: continue
        im = cv2.resize(im, (480, 270)); cv2.putText(im, f"{int(t)//60}:{int(t)%60:02d}", (8, 22), 0, 0.7, (0, 255, 255), 2)
        tiles.append(im)
    while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i+4]) for i in range(0, len(tiles), 4)]
    cv2.imwrite(f"{out}/sheet.jpg", np.vstack(rows))
    print(name, d["title"], dur, f["height"])

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 12)
