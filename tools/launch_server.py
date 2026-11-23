"""Dev: mark ball launches while watching a match (ground truth for the launch counter).
usage: .venv/bin/python launch_server.py   then open http://127.0.0.1:47621
Matches come from dataset/launches/matches.json ([{key, name, team, alliance, videoId, start}]).
J = the scouted team launched a ball, 1-4 = it launched that many at once, F = another robot did. Marks are seconds from the match start,
saved to dataset/launches/<key>.json as you go."""
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIR = "dataset/launches"
MATCHES = json.load(open(f"{DIR}/matches.json"))

PAGE = r"""<!doctype html><meta charset=utf-8><title>Mark launches</title>
<style>
:root{--bg:#111;--fg:#eee;--muted:#9aa;--team:#f2c230;--other:#5ac8fa}
body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui;padding:12px 16px}
#top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
select,button{background:#2a2d33;color:var(--fg);border:1px solid #444;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}
button.on{border-color:var(--team)}
#player{width:min(100%,1100px);aspect-ratio:16/9}
#track{position:relative;height:28px;background:#1d2026;border-radius:6px;margin:8px 0;width:min(100%,1100px)}
#track i{position:absolute;top:4px;width:3px;height:20px;border-radius:2px}
.muted{color:var(--muted)} b.team{color:var(--team)} b.other{color:var(--other)}
kbd{background:#2a2d33;border:1px solid #444;border-radius:4px;padding:1px 6px}
</style>
<div id=top>
 <select id=match></select>
 <span>speed</span><button data-r=1 class=on>1×</button><button data-r=0.5>0.5×</button><button data-r=0.25>0.25×</button>
 <span id=count></span>
</div>
<div class=muted style="margin-bottom:8px">
 <kbd>J</kbd> <b class=team id=teamname>team</b> launched a ball · <kbd>1</kbd>–<kbd>4</kbd> it launched that many at once ·
 <kbd>F</kbd> <b class=other>another robot</b> did (optional) ·
 <kbd>Backspace</kbd> undo · <kbd>Space</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> 5 s · marks save automatically
</div>
<div id=player></div>
<div id=track></div>
<div id=status class=muted></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
const MATCH_S=158;let matches=[],m=null,marks=[],player=null,ready=false;
const $=id=>document.getElementById(id);
function now(){return player&&ready?player.getCurrentTime()-m.start:0}
function draw(){
 const t=$('track');t.innerHTML='';
 for(const k of marks){const i=document.createElement('i');i.style.left=(Math.max(0,Math.min(1,k.t/MATCH_S))*100)+'%';i.style.background=k.who==='team'?'var(--team)':'var(--other)';t.appendChild(i)}
 const nt=marks.filter(k=>k.who==='team').length;$('count').innerHTML=`<b class=team>${nt}</b> team · <b class=other>${marks.length-nt}</b> other`}
async function save(){await fetch('/save/'+m.key,{method:'POST',body:JSON.stringify(marks)});$('status').textContent='saved · '+marks.length+' marks'}
async function open_(k){
 m=matches.find(x=>x.key===k);$('teamname').textContent=m.team;
 marks=await (await fetch('/marks/'+m.key)).json();draw();
 if(player&&ready)player.loadVideoById({videoId:m.videoId,startSeconds:Math.max(0,m.start-3)});
 else player=new YT.Player('player',{videoId:m.videoId,playerVars:{start:Math.floor(Math.max(0,m.start-3)),rel:0},events:{onReady:()=>{ready=true}}});
}
window.onYouTubeIframeAPIReady=async()=>{
 matches=await (await fetch('/matches')).json();
 $('match').innerHTML=matches.map(x=>`<option value="${x.key}">${x.name} · ${x.alliance} · ${x.done?'✓ ':''}</option>`).join('');
 $('match').onchange=e=>open_(e.target.value);open_(matches[0].key)};
document.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{player.setPlaybackRate(+b.dataset.r);document.querySelectorAll('[data-r]').forEach(x=>x.classList.toggle('on',x===b));b.blur()});
onkeydown=e=>{if(!m||e.target.tagName==='SELECT')return;
 const k=e.key.toLowerCase();
 if(k==='j'||k==='f'){marks.push({t:+now().toFixed(2),who:k==='j'?'team':'other'});draw();save()}
 else if('1234'.includes(e.key)){const t=+now().toFixed(2);for(let n=0;n<+e.key;n++)marks.push({t,who:'team',volley:+e.key});draw();save()}
 else if(e.key==='Backspace'){e.preventDefault();const l=marks.pop();if(l&&l.volley)while(marks.length&&marks[marks.length-1].t===l.t&&marks[marks.length-1].volley)marks.pop();draw();save()}
 else if(e.key===' '){e.preventDefault();player.getPlayerState()===1?player.pauseVideo():player.playVideo()}
 else if(e.key==='ArrowLeft')player.seekTo(player.getCurrentTime()-5,true);
 else if(e.key==='ArrowRight')player.seekTo(player.getCurrentTime()+5,true)};
// marks stay in the order pressed, so undo removes the last one pressed
</script>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        b = body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def path_ok(self, key): return any(m["key"] == key for m in MATCHES)
    def do_GET(self):
        p = self.path.split("/")
        if self.path == "/": return self.send(200, PAGE, "text/html")
        if p[1] == "matches":
            return self.send(200, json.dumps([{**m, "done": os.path.exists(f"{DIR}/{m['key']}.json")} for m in MATCHES]))
        if p[1] == "marks" and self.path_ok(p[2]):
            f = f"{DIR}/{p[2]}.json"
            return self.send(200, open(f).read() if os.path.exists(f) else "[]")
        self.send(404, "{}")
    def do_POST(self):
        key = self.path.split("/")[-1]
        if not self.path_ok(key): return self.send(404, "{}")
        marks = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        json.dump(marks, open(f"{DIR}/{key}.json", "w"))
        self.send(200, "{}")

print(f"{len(MATCHES)} matches; open http://127.0.0.1:47621")
ThreadingHTTPServer(("127.0.0.1", 47621), H).serve_forever()
