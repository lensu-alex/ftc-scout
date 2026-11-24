"""Score shooter attribution against the hand labels (labels.json from the labelling page).
usage: python3 score.py labels.json <run>:<dump-dir-or-prefix> ...
  a dump is the DUMP=<file> output of app/scripts/eval-pass2.ts, named <match>_<run>.json in the given folder,
  e.g. score.py labels.json linnew:/tmp/ftc-exp macnew:/tmp/ftc-exp
A volley counts as right when the box of the robot the run picked (slightly enlarged) contains the click, at the click time."""
import json, os, sys

labels = json.load(open(sys.argv[1]))
runs = [a.split(":", 1) for a in sys.argv[2:]]


def pos(D, rid, t):
    tr = next((x for x in D["tracks"] if x["id"] == rid), None) if rid is not None else None
    if not tr:
        return None
    p = min(tr["path"], key=lambda p: abs(p[0] - t))
    return p if abs(p[0] - t) < 1.0 else None


for run, folder in runs:
    tally = {}
    for lab in labels.values():
        m = lab["match"]
        f = os.path.join(folder, f"{m}_{run}.json")
        if not os.path.exists(f):
            continue
        D = json.load(open(f))
        c = [a for a in D["att"] if a["hive"] == lab["hive"] and abs(a["t"] - lab["volleyT"]) <= 0.5]
        t = tally.setdefault(m, {"right": 0, "wrong": 0, "clear_right": 0, "clear_wrong": 0, "skipped": 0})
        if lab["answer"] != "robot" or not c:
            t["skipped"] += 1
            continue
        a = min(c, key=lambda a: abs(a["t"] - lab["volleyT"]))
        p = pos(D, a["robot"], lab["t"])
        # track point = bottom centre of the robot's box (size s): the click must fall in that box, a little enlarged
        ok = p is not None and abs(lab["x720"] - p[1]) <= 0.65 * p[3] and p[2] - 1.1 * p[3] <= lab["y720"] <= p[2] + 0.2 * p[3]
        t["right" if ok else "wrong"] += 1
        if a["confidence"] >= 0.6:
            t["clear_right" if ok else "clear_wrong"] += 1
    tot = {k: sum(x[k] for x in tally.values()) for k in ("right", "wrong", "clear_right", "clear_wrong", "skipped")}
    for m, x in list(tally.items()) + [("all", tot)]:
        n = x["right"] + x["wrong"]
        cn = x["clear_right"] + x["clear_wrong"]
        print(f"{run:8} {m:5} right {x['right']}/{n}" + (f" ({100 * x['right'] / n:.0f}%)" if n else "")
              + f" | marked clear: right {x['clear_right']}/{cn} | not scored {x['skipped']}")
