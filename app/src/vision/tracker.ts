import { iou } from "./detector";
import type { Box, Frame } from "./frame";
import type { Detection } from "./detector";

// Keeps robot identities from frame to frame at a few frames per second.
//
// - Matching is on distance (how far a robot can move between samples), not box overlap:
//   at ~3 fps a fast robot has moved more than its own width.
// - Each track keeps a cheap colour fingerprint, so after a robot was hidden for a few
//   seconds (referee in front, another robot) it is picked up again instead of starting over.
// - A single uncertain detection doesn't create a robot: new tracks must be seen twice.
// Long-gap re-identification (camera cuts, whole-match identity) is done with the appearance
// model afterwards (linkTracks / identify).

export interface Track {
  id: number;
  box: Box;
  vx: number; vy: number;      // px per second
  lastSeen: number;            // stream time
  hits: number;
  hist: Float32Array;          // colour fingerprint
  confirmed: boolean;
  path: { t: number; x: number; y: number; s: number }[]; // box bottom-centre (on the floor) + box size
}

const HB = 8; // hue bins x 3 saturation/value bins + 4 grey levels

/** Small hue/saturation histogram of the box centre: cheap, robust to the box size changing. */
export function colourHist(f: Frame, b: Box): Float32Array {
  const h = new Float32Array(HB * 3 + 4);
  const x0 = Math.max(0, Math.floor(b.x + b.w * 0.15)), x1 = Math.min(f.width, Math.ceil(b.x + b.w * 0.85));
  const y0 = Math.max(0, Math.floor(b.y + b.h * 0.15)), y1 = Math.min(f.height, Math.ceil(b.y + b.h * 0.85));
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const p = (y * f.width + x) * 4, r = f.data[p], g = f.data[p + 1], bl = f.data[p + 2];
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    if (mx < 40 || d < 30) { h[HB * 3 + Math.min(3, mx >> 6)]++; continue; }
    let hue = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    hue = ((hue + 6) % 6) / 6;
    const sv = mx > 170 ? 2 : mx > 100 ? 1 : 0;
    h[Math.min(HB - 1, Math.floor(hue * HB)) * 3 + sv]++;
  }
  let n = 0;
  for (const v of h) n += v * v;
  n = Math.sqrt(n) || 1;
  return h.map(v => v / n);
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export class RobotTracker {
  tracks: Track[] = [];
  private next = 0;
  private maxAge: number;

  constructor(maxAge = 4) {
    this.maxAge = maxAge;
  }

  update(t: number, dets: Detection[], frame?: Frame): Track[] {
    const robots = dets.filter(d => d.cls === "robot");
    const hists = robots.map(d => (frame ? colourHist(frame, d) : new Float32Array(HB * 3 + 4)));
    const live = this.tracks.filter(tr => t - tr.lastSeen <= this.maxAge);
    const pairs: { tr: Track; i: number; cost: number }[] = [];
    for (const tr of live) {
      const dt = t - tr.lastSeen;
      const px = tr.box.x + tr.box.w / 2 + tr.vx * dt, py = tr.box.y + tr.box.h / 2 + tr.vy * dt;
      const size = Math.max(tr.box.w, tr.box.h);
      // how far it could plausibly be from the prediction, in robot lengths (far-away robots are
      // small and move fewer pixels): an FTC robot covers at most ~3 of its lengths per second
      const reach = size * (0.6 + 3 * Math.min(dt, 3));
      robots.forEach((d, i) => {
        const dist = Math.hypot(d.x + d.w / 2 - px, d.y + d.h / 2 - py);
        if (dist > reach) return;
        const look = frame ? dot(tr.hist, hists[i]) : 0.8;
        const sizeRatio = Math.min(d.w * d.h, tr.box.w * tr.box.h) / Math.max(d.w * d.h, tr.box.w * tr.box.h);
        if (look < 0.5 || sizeRatio < 0.25) return;
        pairs.push({ tr, i, cost: dist / reach + (1 - look) + (1 - sizeRatio) * 0.5 });
      });
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedT = new Set<Track>(), usedD = new Set<number>();
    for (const { tr, i } of pairs) {
      if (usedT.has(tr) || usedD.has(i)) continue;
      usedT.add(tr); usedD.add(i);
      const d = robots[i], dt = Math.max(1e-3, t - tr.lastSeen);
      const cx = d.x + d.w / 2, cy = d.y + d.h / 2, ox = tr.box.x + tr.box.w / 2, oy = tr.box.y + tr.box.h / 2;
      tr.vx = 0.5 * tr.vx + 0.5 * ((cx - ox) / dt);
      tr.vy = 0.5 * tr.vy + 0.5 * ((cy - oy) / dt);
      tr.box = { x: d.x, y: d.y, w: d.w, h: d.h };
      for (let k = 0; k < tr.hist.length; k++) tr.hist[k] = 0.8 * tr.hist[k] + 0.2 * hists[i][k];
      tr.lastSeen = t; tr.hits++;
      if (tr.hits >= 2) tr.confirmed = true;
      tr.path.push({ t, x: cx, y: d.y + d.h, s: Math.max(d.w, d.h) });
    }
    const updated = this.tracks.filter(tr => tr.lastSeen === t);
    robots.forEach((d, i) => {
      if (usedD.has(i)) return;
      // a second box on a robot that already has its track this frame would start a duplicate track
      // (two pieces following one robot, which later confuses who is who)
      if (updated.some(tr => iou(tr.box, d) > 0.45)) return;
      // at most 4 robots on the field: a weak extra detection doesn't start a robot
      const active = this.tracks.filter(tr => tr.confirmed && t - tr.lastSeen <= this.maxAge).length;
      if (active >= 4 && d.score < 0.6) return;
      this.tracks.push({
        id: this.next++, box: { x: d.x, y: d.y, w: d.w, h: d.h }, vx: 0, vy: 0, lastSeen: t, hits: 1,
        hist: hists[i], confirmed: false, path: [{ t, x: d.x + d.w / 2, y: d.y + d.h, s: Math.max(d.w, d.h) }],
      });
    });
    // tentative tracks that weren't seen again are dropped
    this.tracks = this.tracks.filter(tr => tr.confirmed || t - tr.lastSeen < 1);
    return this.tracks.filter(tr => tr.lastSeen === t);
  }
}
