"""Shooter classifier with multiple-instance learning.
Bags: each scored volley at a hive = the robots present 0.2-1.8 s before; exactly one shot (positive).
Negatives: windows with no arrival at either hive in the next 3 s. Features from shotfeat.py.
usage: .venv/bin/python shooter_mil.py <match>[,<match>...]   (uses debug/burst/<m>_feat.npz, <m>_{blue,red}_events.txt)
       env HOLD=<match> to hold one match out for testing."""
import sys, os, json, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
matches = sys.argv[1].split(","); HOLD = os.environ.get("HOLD")
HIVES = {"or1": {"blue": 725, "red": 560}, "or5": {"blue": 725, "red": 560}, "or9": {"blue": 725, "red": 560}, "or18": {"blue": 725, "red": 560},
         "q10": {"blue": 727, "red": 568}, "m1": {"blue": 740, "red": 595}}  # cell centre x per hive
FEATS = ["chroma1", "chroma2", "grey", "yel_above", "yel_inside"]

def load(m):
    D = np.load(f"debug/burst/{m}_feat.npz"); fps = int(D["fps"]); ids = D["ids"]
    base = {k: np.nanpercentile(D[k], 60, axis=1) + 2 for k in FEATS}
    ev = {}
    for h in ("blue", "red"):
        p = f"debug/burst/{m}_{h}_events.txt"
        ev[h] = [(float(l.split()[0]), l.split()[1], l.split()[2]) for l in open(p)] if os.path.exists(p) else []
    return D, fps, ids, base, ev

def window(D, fps, base, k, T, hive_x):
    a, b = int((T - 1.8) * fps), int((T - 0.2) * fps)
    if a < 0 or b > D["x"].shape[1]: return None
    present = ~np.isnan(D["x"][k, a:b])
    if present.sum() < 12: return None
    f = []
    for key in FEATS:
        v = np.nan_to_num(D[key][k, a:b]); f += [v.sum(), v.max(), v.sum() / (base[key][k] * present.sum()), (v > 0).mean()]
    sp = D["speed"][k, a:b]; f += [np.nanmedian(sp), np.nanmin(sp), np.nanmax(sp)]
    x, y, s = np.nanmean(D["x"][k, a:b]), np.nanmean(D["y"][k, a:b]), np.nanmean(D["s"][k, a:b])
    f += [(x - hive_x) / s, abs(x - hive_x) / s, y, s, (y < 400) * 1.0]
    return np.array(f, np.float32)

def bags_and_negs(m):
    D, fps, ids, base, ev = load(m)
    bags, negs = [], []
    all_t = sorted(t for h in ev for t, kind, _ in ev[h])
    for h, E in ev.items():
        for T, kind, val in E:
            if kind != "scored": continue
            inst = [(int(ids[k]), window(D, fps, base, k, T, HIVES[m][h])) for k in range(len(ids))]
            inst = [(rid, f) for rid, f in inst if f is not None]
            if len(inst) >= 2: bags.append({"m": m, "hive": h, "t": T, "inst": inst})
    rng = np.random.default_rng(0)
    for T in rng.uniform(3, 150, 400):
        if any(-0.5 <= t - T <= 3.5 for t in all_t): continue      # nothing arrived at any hive soon after
        for k in range(len(ids)):
            f = window(D, fps, base, k, T, HIVES[m]["blue"])
            if f is not None: negs.append(f)
    return bags, negs

data = {m: bags_and_negs(m) for m in matches}
train_m = [m for m in matches if m != HOLD]
def fit(train_m, assign):
    X, y = [], []
    for m in train_m:
        bags, negs = data[m]
        for bi, bag in enumerate(bags):
            for j, (rid, f) in enumerate(bag["inst"]):
                X.append(f); y.append(1 if assign[(m, bi)] == j else 0)
        for f in negs: X.append(f); y.append(0)
    X, y = np.array(X), np.array(y)
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, max_depth=3, min_samples_leaf=25, l2_regularization=2.0, class_weight="balanced", random_state=0)
    clf.fit(X, y); return clf

# init: the instance with the strongest relative chroma streak (feature index 2 = chroma1 relative)
assign = {(m, bi): int(np.argmax([f[2] for rid, f in bag["inst"]])) for m in matches for bi, bag in enumerate(data[m][0])}
for it in range(6):
    clf = fit(train_m, assign)
    changed = 0
    for m in train_m:
        for bi, bag in enumerate(data[m][0]):
            p = clf.predict_proba(np.array([f for rid, f in bag["inst"]]))[:, 1]
            j = int(np.argmax(p))
            if assign[(m, bi)] != j: changed += 1; assign[(m, bi)] = j
    print(f"iter {it}: reassigned {changed}", file=sys.stderr)
    if changed == 0 and it > 1: break

# report per bag: chosen robot, margin
marks = json.load(open("dataset/launches/USORSFM1-1.json"))
mark_t = sorted({round(x["t"], 2) for x in marks if x["who"] == "team"})
for m in matches:
    bags, negs = data[m]
    print(f"== {m}: {len(bags)} volleys, {len(negs)} negative windows" + (" (HELD OUT)" if m == HOLD else ""))
    for bag in bags:
        P = clf.predict_proba(np.array([f for rid, f in bag["inst"]]))[:, 1]
        order = np.argsort(-P); j, j2 = order[0], order[1]
        rid, rid2 = bag["inst"][j][0], bag["inst"][j2][0]
        conf = P[j] / (P[j] + P[j2] + 1e-9)
        note = ""
        if m == "or1" and bag["hive"] == "blue": note = "TEAM" if any(-0.5 <= bag["t"] - mt <= 2.0 for mt in mark_t) else "other"
        print(f"  {bag['hive']:4s} {bag['t']:7.2f} → robot {rid:2d} p={P[j]:.2f} (next {rid2}: {P[j2]:.2f}) conf {conf:.2f} {note}")

    # negatives: how often would a quiet window be called a shot?
    Pn = clf.predict_proba(np.array(negs))[:, 1]
    # alliance consistency: a robot should only ever be assigned to one hive
    per = {}
    for bag in bags:
        P = clf.predict_proba(np.array([f for rid, f in bag["inst"]]))[:, 1]; rid = bag["inst"][int(np.argmax(P))][0]
        per.setdefault(rid, {"blue": 0, "red": 0})[bag["hive"]] += 1
    mixed = sum(min(v["blue"], v["red"]) for v in per.values())
    print(f"  negatives p>0.5: {(Pn > 0.5).mean():.1%}  p>0.8: {(Pn > 0.8).mean():.1%} | per robot blue/red: " + " ".join(f"{r}:{v['blue']}/{v['red']}" for r, v in sorted(per.items())) + f" | mixed-hive assignments {mixed}")
import pickle; pickle.dump(clf, open("debug/burst/shooter_clf.pkl", "wb"))
