import type { EvidenceSample, Launch } from "../vision/launchEvidence";
import type { HiveEvent } from "../vision/hive";

// Which robot scored each volley: the same-alliance robot with the most launch evidence just before the
// balls arrived at the hive. Evidence = new yellowness above the robot (pixels, relative to its usual level,
// blobs) and tracked launches. Confidence comes from the gap to the runner-up.

export interface Attribution {
  t: number; hive: "red" | "blue"; balls: number;
  robot: number | null; confidence: number;        // 0..1
  evidence: { robot: number; px: number; rel: number; blobs: number; launches: number }[];
}

export function attributeVolleys(
  events: (HiveEvent & { hive: "red" | "blue" })[], samples: EvidenceSample[], launches: Launch[],
  alliance: (robotId: number) => "red" | "blue" | null,
  win: { before: number; after: number; fromRise?: boolean } = { before: 1.7, after: 0.3 },
): Attribution[] {
  // the window before the arrival where the launch happened
  const windowOf = (e: HiveEvent) => { const ref = win.fromRise && e.riseAt !== undefined ? e.riseAt : e.t; return [ref - win.before, ref - win.after] as const; };
  // usual level per robot (60th percentile of its pixel evidence over all samples)
  const per = new Map<number, number[]>();
  for (const s of samples) for (const [id, v] of s.above) (per.get(id) ?? per.set(id, []).get(id)!).push(v.px);
  const base = new Map<number, number>();
  for (const [id, arr] of per) { const a = [...arr].sort((x, y) => x - y); base.set(id, (a[Math.floor(0.6 * (a.length - 1))] ?? 0) + 1); }
  // robots whose alliance is unknown: the hive their launch evidence precedes most often is theirs
  const known = new Map<number, "red" | "blue" | null>();
  const allIds = new Set<number>(); for (const s of samples) for (const id of s.above.keys()) allIds.add(id);
  for (const id of allIds) {
    let al = alliance(id);
    if (al === null) {
      const sum = { red: 0, blue: 0 };
      for (const e of events) {
        if (e.kind !== "scored") continue;
        const [w0, w1] = windowOf(e);
        const win = samples.filter(s => s.t >= w0 && s.t <= w1);
        const vals = win.map(s => s.above.get(id)?.px).filter((v): v is number => v !== undefined);
        if (vals.length >= 10) sum[e.hive] += vals.reduce((a, v) => a + v, 0) / ((base.get(id) ?? 1) * vals.length);
      }
      if (sum.red + sum.blue > 0) al = sum.blue > sum.red ? "blue" : "red";
    }
    known.set(id, al);
  }
  const out: Attribution[] = [];
  for (const e of events) {
    if (e.kind !== "scored") continue;
    const T = e.t, [w0, w1] = windowOf(e), win = samples.filter(s => s.t >= w0 && s.t <= w1);
    const score = new Map<number, { s: number; px: number; rel: number; blobs: number; launches: number }>();
    const ids = new Set<number>(); for (const s of win) for (const id of s.above.keys()) ids.add(id);
    for (const id of ids) {
      const al = known.get(id) ?? null;
      if (al !== null && al !== e.hive) continue;
      const vals = win.map(s => s.above.get(id)).filter((v): v is { px: number; blobs: number } => !!v);
      if (vals.length < 10) continue;
      const px = vals.reduce((a, v) => a + v.px, 0), blobs = vals.reduce((a, v) => a + v.blobs, 0);
      const rel = px / ((base.get(id) ?? 1) * vals.length);
      const nl = launches.filter(l => l.robot === id && l.t >= w0 - 0.3 && l.t <= w1).length;
      score.set(id, { s: Math.log1p(px) + 0.8 * Math.log1p(rel) + 0.5 * Math.log1p(blobs) + 1.2 * nl, px, rel, blobs, launches: nl });
    }
    const ranked = [...score.entries()].sort((a, b) => b[1].s - a[1].s);
    if (!ranked.length) { out.push({ t: T, hive: e.hive, balls: e.balls ?? 0, robot: null, confidence: 0, evidence: [] }); continue; }
    const gap = ranked[0][1].s - (ranked[1]?.[1].s ?? 0);
    const confidence = ranked[0][1].px > 0 ? 1 - Math.exp(-gap / 1.5) : 0;
    out.push({
      t: T, hive: e.hive, balls: e.balls ?? 0, robot: ranked[0][0], confidence,
      evidence: ranked.slice(0, 3).map(([robot, v]) => ({ robot, px: v.px, rel: +v.rel.toFixed(1), blobs: v.blobs, launches: v.launches })),
    });
  }
  return out;
}

/** Balls per robot: sure (confidence ≥ 0.6) and unsure. */
export function perRobot(a: Attribution[]) {
  const m = new Map<number, { sure: number; unsure: number; volleys: number }>();
  for (const x of a) {
    if (x.robot === null) continue;
    const r = m.get(x.robot) ?? { sure: 0, unsure: 0, volleys: 0 };
    r.volleys++; if (x.confidence >= 0.6) r.sure += x.balls; else r.unsure += x.balls;
    m.set(x.robot, r);
  }
  return m;
}
