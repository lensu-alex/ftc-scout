import { describe, it, expect } from "vitest";
import { hiveEvents, type HiveSample } from "../vision/hive";
import { attributeVolleys } from "../analysis/attribution";
import { splitAlliance } from "../analysis/pieces";
import { callVolleys } from "../analysis/whoShot";
import type { MatchAnalysis } from "../analysis/analyzeMatch";

const series = (steps: [number, number][], fps = 10): HiveSample[] => {
  // steps: [untilSeconds, level]
  const out: HiveSample[] = [];
  let t = 0;
  for (const [until, level] of steps) for (; t < until; t += 1 / fps) out.push({ t: +t.toFixed(2), area: level + (Math.sin(t * 7) * 8), bumps: 0 });
  return out;
};

describe("hiveEvents", () => {
  it("reads a staircase as volleys and a drop as a tip", () => {
    const s = series([[5, 0], [10, 400], [15, 700], [20, 0], [25, 200]]);
    const { events, scored, tips } = hiveEvents(s, 100);
    expect(events.filter(e => e.kind === "scored").map(e => e.balls)).toEqual([4, 3, 2]);
    expect(scored).toBe(9);
    expect(tips).toBe(1);
    expect(events[0].riseAt).toBeCloseTo(5, 0);
  });
  it("ignores wobble smaller than half a ball", () => {
    const s = series([[20, 300]]);
    expect(hiveEvents(s, 100).events).toHaveLength(0);
  });
  it("disc mode: counts hold 2 s before they count (a robot passing under the hive does not)", () => {
    const s: HiveSample[] = [];
    for (let t = 0; t < 30; t += 0.1) s.push({ t: +t.toFixed(1), area: 0, bumps: 0, discs: t >= 10 && t < 11 ? 3 : t >= 20 ? 2 : 0 });
    const { events } = hiveEvents(s, 100, 0.6, "discs");
    expect(events.filter(e => e.kind === "scored").map(e => e.balls)).toEqual([2]);
  });
  it("does not call a one-ball drop a tip", () => {
    const s = series([[5, 100], [10, 0]]);
    expect(hiveEvents(s, 100).tips).toBe(0);
  });
});

describe("attributeVolleys", () => {
  const samples = (t0: number, t1: number, px: Record<number, number>) => {
    const out = [];
    for (let t = t0; t <= t1; t += 1 / 30) out.push({ t, above: new Map(Object.entries(px).map(([id, v]) => [+id, { px: v, blobs: v ? 2 : 0 }])) });
    return out;
  };
  it("picks the same-alliance robot with evidence and gives a confidence", () => {
    const quiet = samples(0, 8, { 1: 0, 2: 0, 3: 0 });
    const loud = samples(8.2, 9.7, { 1: 40, 2: 0, 3: 200 });   // robot 3 is red: must not win a blue volley
    const att = attributeVolleys([{ t: 10, riseAt: 10, kind: "scored", balls: 2, from: 0, to: 200, hive: "blue" }], [...quiet, ...loud], [],
      id => (id === 3 ? "red" : "blue"));
    expect(att[0].robot).toBe(1);
    expect(att[0].confidence).toBeGreaterThan(0.6);
  });
  it("is unsure when both alliance robots show the same evidence", () => {
    const quiet = samples(0, 8, { 1: 0, 2: 0 });
    const loud = samples(8.2, 9.7, { 1: 40, 2: 40 });
    const att = attributeVolleys([{ t: 10, riseAt: 10, kind: "scored", balls: 2, from: 0, to: 200, hive: "blue" }], [...quiet, ...loud], [], () => "blue");
    expect(att[0].confidence).toBeLessThan(0.3);
  });
});

const piece = (id: number, from: number, to: number, x: number, emb: number[]): MatchAnalysis["robots"][number] => ({
  id, hits: 50, view: 0, red: 0, blue: 0, crop: null, launches: [],
  embedding: new Float32Array(emb), path: [{ t: from, x, y: 300, s: 40 }, { t: to, x, y: 300, s: 40 }],
});
const analysis = (robots: MatchAnalysis["robots"]) => ({ robots, start: 0 }) as unknown as MatchAnalysis;

describe("splitAlliance", () => {
  it("puts a piece that overlaps the team in time with the partner", () => {
    const a = analysis([piece(1, 0, 50, 600, [1, 0]), piece(2, 10, 60, 700, [0, 1]), piece(3, 55, 120, 600, [1, 0])]);
    const sp = splitAlliance(a, [1, 2, 3], [1]);
    expect(sp.partner).toContain(2);
    expect(sp.team).toContain(3);        // looks like 1 and continues it
  });
});

describe("callVolleys", () => {
  it("one place at a time: a shooter not in a sure chain is the partner when the team is seen elsewhere", () => {
    const att = [{ t: 30, hive: "blue" as const, balls: 2, robot: 9, confidence: 0.9, evidence: [] }];
    const spans = [{ id: 1, from: 0, to: 60 }, { id: 9, from: 25, to: 40 }];
    const calls = callVolleys(att, { team: [], partner: [] }, () => null, { team: [1], partner: [], unsure: [] }, [1], spans);
    expect(calls[0].who).toBe("partner");
    expect(calls[0].margin).toBeGreaterThanOrEqual(0.5);
  });
  it("leaves a volley open when neither robot is seen elsewhere and looks are weak", () => {
    const att = [{ t: 30, hive: "blue" as const, balls: 2, robot: 9, confidence: 0.9, evidence: [] }];
    const calls = callVolleys(att, { team: [new Float32Array([1, 0])], partner: [new Float32Array([0.9, 0.1])] }, () => new Float32Array([0.95, 0.05]), { team: [], partner: [], unsure: [9] }, [], [{ id: 9, from: 25, to: 40 }]);
    expect(calls[0].who).toBeNull();
  });
  it("uses looks when they are clear, the chain otherwise", () => {
    const att = [
      { t: 10, hive: "blue" as const, balls: 2, robot: 7, confidence: 0.9, evidence: [] },
      { t: 20, hive: "blue" as const, balls: 1, robot: 8, confidence: 0.9, evidence: [] },
    ];
    const team = [new Float32Array([1, 0])], partner = [new Float32Array([0, 1])];
    const look = (i: number) => (i === 0 ? new Float32Array([0.9, 0.1]) : null);
    const calls = callVolleys(att, { team, partner }, look, { team: [], partner: [8], unsure: [] });
    expect(calls[0].who).toBe("team");
    expect(calls[1].who).toBe("partner");
  });
});
