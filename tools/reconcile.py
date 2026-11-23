"""Join launches per robot (1080p) with hive arrivals: which robot scored each volley.
usage: .venv/bin/python reconcile.py <launches.json> <blue_events.txt> <red_events.txt>"""
import sys, json
L = json.load(open(sys.argv[1]))
import os
ALL = json.loads(os.environ.get("ALLIANCE", "{}"))   # {"blue":[ids], "red":[ids]} when known
ev = {}
for h, p in (("blue", sys.argv[2]), ("red", sys.argv[3])):
    ev[h] = [(float(l.split()[0]), l.split()[1], l.split()[2]) for l in open(p) if l.strip()]
# launch clusters per robot: launches within 0.7 s of each other
clusters = []
for l in sorted(L, key=lambda l: (l["robot"], l["t"])):
    if clusters and clusters[-1]["robot"] == l["robot"] and l["t"] - clusters[-1]["t1"] <= 0.7:
        clusters[-1]["t1"] = l["t"]; clusters[-1]["n"] += 1
    else: clusters.append({"robot": l["robot"], "t0": l["t"], "t1": l["t"], "n": 1})
clusters.sort(key=lambda c: c["t0"])
per_robot = {}
print("hive   arrival  scored | launch cluster(s) 0.2-2.0 s before: robot(n launches)")
for h in ("blue", "red"):
    for T, kind, val in ev[h]:
        if kind != "scored": continue
        cand = [c for c in clusters if (0.2 <= T - c["t1"] <= 2.0 or (c["t0"] <= T - 0.2 <= c["t1"])) and (not ALL or c["robot"] in ALL.get(h, []))]
        cand.sort(key=lambda c: -c["n"])
        who = cand[0]["robot"] if cand else None
        if who is not None: per_robot.setdefault(who, {"blue": 0, "red": 0, "balls": 0}); per_robot[who][h] += 1; per_robot[who]["balls"] += int(val)
        print(f"{h:5s} {T:7.2f} {val:>4s} | " + ("  ".join(f"{c['robot']}({c['n']}) @{c['t0']:.1f}-{c['t1']:.1f}" for c in cand[:3]) or "no launch seen"))
print("\nper robot: volleys attributed blue/red, balls scored:")
for r, v in sorted(per_robot.items()): print(f"  robot {r}: blue {v['blue']} red {v['red']} → {v['balls']} balls")
unused = [c for c in clusters if not any(0.2 <= T - c["t1"] <= 2.0 or c["t0"] <= T - 0.2 <= c["t1"] for h in ev for T, k, v in ev[h] if k == "scored")]
print(f"\nlaunch clusters with no arrival (misses / noise): {len(unused)} of {len(clusters)}: " + " ".join(f"{c['robot']}({c['n']})@{c['t0']:.1f}" for c in unused[:30]))
