"""For each hive arrival: same-alliance robots ranked by new-yellow evidence above them (1080p) in the 1.6 s before.
usage: ALLIANCE='{"blue":[..],"red":[..]}' .venv/bin/python eval_attr.py <attr.npz> <blue_events> <red_events> [launches.json]"""
import sys, os, json, numpy as np
D = np.load(sys.argv[1]); t = D["t"]; A = D["above"]; Bl = D["blobs"]; ids = [int(x) for x in D["ids"]]
ALL = json.loads(os.environ.get("ALLIANCE", "{}"))
L = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else []
base = np.nanpercentile(A, 60, axis=0) + 1
tot = {}
for h, p in (("blue", sys.argv[2]), ("red", sys.argv[3])):
    print(f"== {h} hive")
    for l in open(p):
        T, kind, val = float(l.split()[0]), l.split()[1], l.split()[2]
        if kind != "scored": continue
        w = (t >= T - 1.8) & (t <= T - 0.2)
        rows = []
        for k, rid in enumerate(ids):
            if ALL and rid not in ALL.get(h, []): continue
            a = A[w, k]; n = (~np.isnan(a)).sum()
            if n < 10: continue
            rows.append((rid, float(np.nansum(a)), float(np.nansum(a)) / (base[k] * n), float(np.nansum(Bl[w, k]))))
        rows.sort(key=lambda r: -r[1])
        fl = [x for x in L if T - 2.0 <= x["t"] <= T - 0.2 and (not ALL or x["robot"] in ALL.get(h, []))]
        flc = {}
        for x in fl: flc[x["robot"]] = flc.get(x["robot"], 0) + 1
        if rows:
            top = rows[0]; second = rows[1] if len(rows) > 1 else None
            margin = top[1] / (second[1] + 1) if second else 99
            sure = top[3] >= 2 and margin >= 2.5
            if sure: tot[top[0]] = tot.get(top[0], 0) + int(val)
            print(f"  {T:7.2f} {val:>3s} | " + "  ".join(f"{r[0]}:{int(r[1])}px/{int(r[3])}blobs({r[2]:.1f}x)" for r in rows[:3]) + f" | margin {margin:4.1f} {'SURE' if sure else 'unsure'} | flights {flc}")
        else: print(f"  {T:7.2f} {val:>3s} | no candidate robot tracked")
print("sure volleys per robot (balls):", tot)
