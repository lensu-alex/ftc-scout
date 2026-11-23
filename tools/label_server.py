"""Dev: a tiny page to correct robot boxes by hand (balls stay auto-labelled).
usage: .venv/bin/python label_server.py [dataset/yolo3]   then open http://127.0.0.1:47620
Frames where the auto-labels most likely miss robots come first (fewest robots found).
Corrections are saved to dataset/human/<frame>.txt (robot boxes only, YOLO format); prelabel/train use them later."""
import glob, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = sys.argv[1] if len(sys.argv) > 1 else "dataset/yolo3"
OUT = "dataset/human"
os.makedirs(OUT, exist_ok=True)

def robots(txt):
    return [list(map(float, l.split()[1:])) for l in open(txt) if l.startswith("0 ")] if os.path.exists(txt) else []

frames = []
for txt in glob.glob(f"{ROOT}/labels/*/*.txt"):
    name = os.path.basename(txt)[:-4]
    frames.append((len(robots(txt)), name, txt))
frames.sort()  # fewest robots first: most likely to be missing some
# the original (not greyed) frame is what a person should look at
RAW = "dataset/train_raw"

PAGE = """<!doctype html><meta charset=utf-8><title>Robot boxes</title>
<style>
:root{--bg:#111;--fg:#eee;--muted:#999;--ok:#3c3;--bad:#f55}
body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui;display:flex;flex-direction:column;align-items:center}
#bar{padding:8px 16px;display:flex;gap:16px;align-items:center;width:100%;box-sizing:border-box}
#wrap{position:relative;max-width:100vw}
canvas{max-width:100vw;cursor:crosshair;display:block}
.muted{color:var(--muted)}
button{background:#333;color:var(--fg);border:1px solid #555;border-radius:6px;padding:6px 12px;cursor:pointer}
</style>
<div id=bar><b id=name></b><span id=count class=muted></span>
<span class=muted>drag = add robot · click a box = remove · Enter = save &amp; next · ← back</span>
<button id=save>Save &amp; next (Enter)</button></div>
<div id=wrap><canvas id=c></canvas></div>
<script>
let list=[],i=0,img=new Image(),boxes=[],drag=null;
const c=document.getElementById('c'),x=c.getContext('2d');
async function load(){const r=await fetch('/frame/'+list[i]);const d=await r.json();boxes=d.boxes;
 document.getElementById('name').textContent=list[i];document.getElementById('count').textContent=(i+1)+' / '+list.length+(d.done?' · already saved':'');
 img=new Image();img.onload=()=>{c.width=img.width;c.height=img.height;draw()};img.src='/img/'+list[i]}
function draw(){x.drawImage(img,0,0);x.lineWidth=3;
 for(const b of boxes){x.strokeStyle='#3c3';x.strokeRect((b[0]-b[2]/2)*c.width,(b[1]-b[3]/2)*c.height,b[2]*c.width,b[3]*c.height)}
 if(drag&&drag.w){x.strokeStyle='#ff0';x.strokeRect(drag.x,drag.y,drag.w,drag.h)}}
function pos(e){const r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
c.onmousedown=e=>{const[a,b]=pos(e);drag={x0:a,y0:b,x:a,y:b,w:0,h:0}};
c.onmousemove=e=>{if(!drag)return;const[a,b]=pos(e);drag.x=Math.min(a,drag.x0);drag.y=Math.min(b,drag.y0);drag.w=Math.abs(a-drag.x0);drag.h=Math.abs(b-drag.y0);draw()};
c.onmouseup=e=>{const[a,b]=pos(e);
 if(drag&&drag.w>8&&drag.h>8){boxes.push([(drag.x+drag.w/2)/c.width,(drag.y+drag.h/2)/c.height,drag.w/c.width,drag.h/c.height])}
 else{const u=a/c.width,v=b/c.height;const k=boxes.findIndex(q=>Math.abs(u-q[0])<q[2]/2&&Math.abs(v-q[1])<q[3]/2);if(k>=0)boxes.splice(k,1)}
 drag=null;draw()};
async function save(){await fetch('/save/'+list[i],{method:'POST',body:JSON.stringify(boxes)});if(i<list.length-1){i++;load()}}
document.getElementById('save').onclick=save;
onkeydown=e=>{if(e.key==='Enter')save();if(e.key==='ArrowLeft'&&i>0){i--;load()}};
fetch('/list').then(r=>r.json()).then(l=>{list=l;const k=l.findIndex(n=>!n.startsWith('*'));list=l.map(n=>n.replace('*',''));i=Math.max(0,k);load()});
</script>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path.split("/")
        if self.path == "/": return self.send(200, PAGE, "text/html")
        if p[1] == "list":  # done frames marked with * (the page starts at the first not done)
            return self.send(200, json.dumps([("*" if os.path.exists(f"{OUT}/{n}.txt") else "") + n for _, n, _ in frames]))
        name = os.path.basename(p[-1])
        hit = next((f for f in frames if f[1] == name), None)
        if not hit: return self.send(404, "{}")
        if p[1] == "img": return self.send(200, open(f"{RAW}/{name}.jpg", "rb").read(), "image/jpeg")
        if p[1] == "frame":
            done = os.path.exists(f"{OUT}/{name}.txt")
            return self.send(200, json.dumps({"boxes": robots(f"{OUT}/{name}.txt" if done else hit[2]), "done": done}))
        self.send(404, "{}")
    def do_POST(self):
        name = os.path.basename(self.path)
        if not any(f[1] == name for f in frames): return self.send(404, "{}")
        boxes = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with open(f"{OUT}/{name}.txt", "w") as fh:
            for b in boxes: fh.write("0 " + " ".join(f"{float(v):.6f}" for v in b[:4]) + "\n")
        self.send(200, "{}")

print(f"{len(frames)} frames from {ROOT}; open http://127.0.0.1:47620 (saved so far: {len(os.listdir(OUT))})")
ThreadingHTTPServer(("127.0.0.1", 47620), H).serve_forever()
