"""Who scored each volley: fuse 1080p launch evidence above each same-alliance robot (attr1080.npz) with
flight-tracker launch clusters (flights1080.py). Output per volley: robot, confidence; per robot: balls scored.
usage: ALLIANCE='{"blue":[..],"red":[..]}' .venv/bin/python attribute_final.py <attr.npz> <launches.json> <blue_events> <red_events> [out.json]"""
import sys, os, json, numpy as np
D = np.load(sys.argv[1]); t = D["t"]; A = D["above"]; Bl = D["blobs"]; ids = [int(x) for x in D["ids"]]
L = json.load(open(sys.argv[2]))
ALL = json.loads(os.environ.get("ALLIANCE", "{}"))
base = np.nanpercentile(A, 60, axis=0) + 1
out = []; per = {}
for h, p in (("blue", sys.argv[3]), ("red", sys.argv[4])):
    for l in open(p):
        T, kind, val = float(l.split()[0]), l.split()[1], l.split()[2]
        if kind != "scored": continue
        n_balls = int(val)
        cands = [rid for rid in ids if not ALL or rid in ALL.get(h, [])]
        w = (t >= T - 1.7) & (t <= T - 0.3)
        score = {}
        for rid in cands:
            k = ids.index(rid); a = A[w, k]; n = (~np.isnan(a)).sum()
            if n < 10: continue
            ev_px = float(np.nansum(a)); rel = ev_px / (base[k] * n); blobs = float(np.nansum(Bl[w, k]))
            fl = sum(1 for x in L if x["robot"] == rid and T - 2.0 <= x["t"] <= T - 0.3)
            # evidence: pixels (log), relative to usual (log), blobs, and tracked launches (strong)
            s = np.log1p(ev_px) + 0.8 * np.log1p(rel) + 0.5 * np.log1p(blobs) + 1.2 * fl
            score[rid] = (s, ev_px, rel, blobs, fl)
        if not score:
            out.append({"hive": h, "t": T, "balls": n_balls, "robot": None, "conf": 0}); continue
        ranked = sorted(score.items(), key=lambda kv: -kv[1][0])
        top = ranked[0]; second = ranked[1] if len(ranked) > 1 else None
        gap = top[1][0] - (second[1][0] if second else 0)
        conf = float(1 - np.exp(-gap / 1.5)) if top[1][1] > 0 else 0.0
        out.append({"hive": h, "t": T, "balls": n_balls, "robot": top[0], "conf": round(conf, 2),
                    "evidence": {rid: {"px": int(v[1]), "rel": round(v[2], 1), "blobs": int(v[3]), "launches": v[4]} for rid, v in ranked[:3]}})
        per.setdefault(top[0], {"sure": 0, "unsure": 0, "volleys": 0})
        per[top[0]]["volleys"] += 1
        per[top[0]]["sure" if conf >= 0.6 else "unsure"] += n_balls
for o in sorted(out, key=lambda o: o["t"]):
    e = o.get("evidence", {})
    print(f"{o['hive']:4s} {o['t']:7.2f} +{o['balls']} → robot {o['robot']} conf {o['conf']:.2f} | " + "  ".join(f"{r}:{v['px']}px {v['rel']}x {v['blobs']}b {v['launches']}L" for r, v in e.items()))
print("per robot balls: " + "  ".join(f"{r}: {v['sure']} sure + {v['unsure']} unsure ({v['volleys']} volleys)" for r, v in sorted(per.items())))
if len(sys.argv) > 5: json.dump(out, open(sys.argv[5], "w"), indent=1)
