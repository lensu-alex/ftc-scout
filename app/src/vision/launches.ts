import type { Box, Frame } from "./frame";

// Launches: a pollen ball leaving a robot. Small yellow things that moved since the last frame are
// followed from frame to frame (~10 fps); one that starts at a robot and keeps moving away from it,
// faster than a robot can push a ball, is a launch by that robot. Plain colour + motion on a
// 640x360 copy: no model, cheap enough for every frame.

const W = 640, H = 360;
/** Dev scripts switch on the smear log (streakLog). */
export const launchDebug = { on: false };
const MIN_PX = 2, MAX_PX = 80;     // blob size at 640x360 (a ball is ~3-8 px across)
const NEAR = 0.3;                  // a flight starts within the robot's box grown by this share
const FAST = 6;                    // robot lengths per second: a launched ball (~10/s), not a pushed one (1-3/s)
const STEP = 0.4;                  // ...and every step between frames at least this many robot lengths

// x, y: where it left (1280x720); strong = followed for 4+ frames (weak ones set the high end of the estimate)
export interface Launch {
  t: number; robot: number; x: number; y: number; strong: boolean; kind?: "streak" | "flight";
  // measurements of the smear (for tuning): length/width in px at 640x360, angle from vertical (deg),
  // lower end relative to the robot box top (robot heights; < 0 = above it), robot speed (lengths/s)
  feat?: { len: number; wid: number; n: number; tilt: number; rel: number; rspeed: number; rsize: number };
}
/** Dev: every smear seen (any place), to check afterwards whether a launch kept flying. */
export const streakLog: { t: number; x: number; y: number; y0: number; y1: number; len: number }[] = [];
/** Dev: anything yellow that moved, just above or on a robot (a loose net for counting launches by hand). */
export const candLog: { t: number; robot: number; x: number; y: number; box: Box }[] = [];
/** Dev: moving yellow blobs (balls in motion) per frame. */
export const blobLog: { t: number; x: number; y: number }[] = [];
export interface RobotBox { id: number; box: Box }

// box = the robot now; c0 = the robot's centre when the flight started (to subtract the robot's own motion)
interface Flight { robot: number; box: Box; c0: { x: number; y: number }; pts: { t: number; x: number; y: number }[]; done: boolean; sent: boolean }

export class LaunchDetector {
  private prevGrey: Uint8Array | null = null;
  private prevYellow: Uint8Array | null = null;
  private flights: Flight[] = [];
  private streakSeen: { t: number; robot: number; x: number; y: number }[] = [];
  // how often each pixel has been yellow (slow average): post tops and signs are always yellow,
  // a ball flying past isn't
  private yellowRate = new Float32Array(W * H);
  private lastBox = new Map<number, { t: number; box: Box }>(); // robot speed
  // streak launches wait one frame: if the smear shows up lower in the next frame, the ball was falling
  // (out of a tipping hive), not launched
  private pending: { l: Launch; sx: number; sy: number; len: number; t: number; falling: boolean }[] = [];
  // moving balls of the last ~0.7 s: a hive tipping over sends many balls at once (a robot launches ≤ 4)
  private recentBlobs: { t: number; x: number; y: number }[] = [];
  private sx = 1; private sy = 1;

  /** One frame; returns the launches confirmed in it. `robots` = where the robots are now (frame coords). */
  push(t: number, f: Frame, robots: RobotBox[], roi?: Box): Launch[] {
    this.sx = f.width / W; this.sy = f.height / H;
    const grey = new Uint8Array(W * H), yellow = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (Math.floor((y + 0.5) * this.sy) * f.width + Math.floor((x + 0.5) * this.sx)) * 4;
      const r = f.data[p], g = f.data[p + 1], b = f.data[p + 2], i = y * W + x;
      grey[i] = (r * 77 + g * 150 + b * 29) >> 8;
      // pollen yellow: red and green high, blue low; not the yellow-green of safety vests (green >> red)
      yellow[i] = r > 120 && g > 110 && b < 0.6 * g && r >= 0.9 * g && r - g < 70 ? 1 : 0;
    }
    const prevG = this.prevGrey, prevY = this.prevYellow;
    for (let i = 0; i < W * H; i++) this.yellowRate[i] = 0.98 * this.yellowRate[i] + 0.02 * yellow[i];
    this.prevGrey = grey; this.prevYellow = yellow;
    if (!prevG || !prevY) return [];

    // yellow now, not yellow at that spot a frame ago, and the picture changed there
    const mask = new Uint8Array(W * H);
    const r0 = roi ? { x0: Math.max(0, Math.floor(roi.x / this.sx)), y0: Math.max(0, Math.floor(roi.y / this.sy)), x1: Math.min(W, Math.ceil((roi.x + roi.w) / this.sx)), y1: Math.min(H, Math.ceil((roi.y + roi.h) / this.sy)) } : { x0: 0, y0: 0, x1: W, y1: H };
    for (let y = r0.y0; y < r0.y1; y++) for (let x = r0.x0; x < r0.x1; x++) {
      const i = y * W + x;
      if (yellow[i] && !prevY[i] && Math.abs(grey[i] - prevG[i]) > 25) mask[i] = 1;
    }
    const blobs = components(mask);
    if (launchDebug.on) for (const b of blobs) blobLog.push({ t, x: b.x * this.sx, y: b.y * this.sy });

    // streaks: a launched ball is a long, thin, motion-blurred yellow smear in one frame; balls on
    // the floor move far too slowly to smear. One smear near a robot = one ball leaving it.
    const soft = new Uint8Array(W * H);
    for (let y = r0.y0; y < r0.y1; y++) for (let x = r0.x0; x < r0.x1; x++) {
      const i = y * W + x, p = (Math.floor((y + 0.5) * this.sy) * f.width + Math.floor((x + 0.5) * this.sx)) * 4;
      const r = f.data[p], g = f.data[p + 1], b = f.data[p + 2];
      // (r >= 0.95 g: pollen is a warm yellow; safety vests are a greener yellow)
      // (r <= 1.35 g: orange plates and parts are red-heavy; pollen yellow has red ≈ green)
      if (r > 105 && g > 95 && b < 0.8 * g && r >= 0.95 * g && r <= 1.35 * g && r - b > 45 && Math.abs(grey[i] - prevG[i]) > 18 && this.yellowRate[i] < 0.4) soft[i] = 1;
    }
    // a launched ball smears along its flight, which is close to vertical on any camera (it goes up to the
    // hive); sideways smears are wheels, plates and robot edges, 1 px thin ones are edges and clothing.
    // (Measured on 58 hand-checked candidates: keeps 13/14 real launches, drops 38/44 false ones.)
    const streaks = shapes(soft).filter(c => c.len >= 9 && c.len >= 2.4 * c.wid && c.n <= 220 && c.tilt <= 20 && c.wid >= 2.5);
    this.recentBlobs.push(...blobs.map(b => ({ t, x: b.x, y: b.y })));
    this.recentBlobs = this.recentBlobs.filter(b => t - b.t <= 0.7);
    // settle launches 0.3 s later:
    // - a vertical smear just below it in the next frame = the ball was falling (out of a hive)
    // - 6+ moving balls around it in one frame within ±0.3 s = a hive tipping, not a launch
    //   (measured on 38 hand-checked launches: precision 39 → 54%, 14 of 15 real kept)
    const settled: Launch[] = [];
    for (const p of this.pending) {
      if (!p.falling && t - p.t < 0.15) p.falling = streaks.some(c => Math.abs(c.x - p.sx) < 2 * p.len && c.y > p.sy + 0.3 * p.len && c.y < p.sy + 4 * p.len);
    }
    this.pending = this.pending.filter(p => {
      if (t - p.t < 0.3) return true;
      const perFrame = new Map<number, number>();
      for (const b of this.recentBlobs) {
        if (Math.abs(b.t - p.t) <= 0.3 && Math.abs(b.x - p.sx) <= 75 && b.y < p.sy + 25) perFrame.set(b.t, (perFrame.get(b.t) ?? 0) + 1);
      }
      const burst = Math.max(0, ...perFrame.values());
      if (!p.falling && burst < 6) settled.push(p.l);
      return false;
    });
    if (launchDebug.on) for (const c of streaks) streakLog.push({ t, x: c.x * this.sx, y: c.y * this.sy, y0: c.y0 * this.sy, y1: c.y1 * this.sy, len: c.len * this.sx });

    // robot boxes in 640x360 coords
    const rbDev = robots.map(r => ({ id: r.id, box: { x: r.box.x / this.sx, y: r.box.y / this.sy, w: r.box.w / this.sx, h: r.box.h / this.sy } }));
    if (launchDebug.on) {
      // loose: any moving yellow thing (blob or smear) from 1.5 robot heights above the robot's top down to its middle
      for (const c of [...blobs.map(b => ({ x: b.x, y: b.y })), ...shapes(soft).map(c => ({ x: c.x, y: c.y1 }))]) {
        for (const r of rbDev) {
          if (c.x >= r.box.x - 0.2 * r.box.w && c.x <= r.box.x + 1.2 * r.box.w && c.y >= r.box.y - 1.5 * r.box.h && c.y <= r.box.y + 0.5 * r.box.h)
            candLog.push({ t, robot: r.id, x: c.x * this.sx, y: c.y * this.sy, box: { x: r.box.x * this.sx, y: r.box.y * this.sy, w: r.box.w * this.sx, h: r.box.h * this.sy } });
        }
      }
    }
    const rb = robots.map(r => ({ id: r.id, box: { x: r.box.x / this.sx, y: r.box.y / this.sy, w: r.box.w / this.sx, h: r.box.h / this.sy } }));
    this.flights = this.flights.filter(fl => t - fl.pts[fl.pts.length - 1].t < 0.35);
    // flights follow their robot: a ball carried by a driving robot moves with it, it doesn't leave it
    for (const fl of this.flights) { const r = rb.find(r => r.id === fl.robot); if (r) fl.box = r.box; }
    const used = new Set<number>(), out: Launch[] = [];

    // 1) continue flights: the nearest blob that is further from the robot than the last point
    for (const fl of this.flights) {
      const last = fl.pts[fl.pts.length - 1], size = Math.max(fl.box.w, fl.box.h);
      const cx = fl.box.x + fl.box.w / 2, cy = fl.box.y + fl.box.h / 2;
      let best = -1, bd = Infinity;
      blobs.forEach((b, k) => {
        if (used.has(k)) return;
        const d = Math.hypot(b.x - last.x, b.y - last.y);
        if (d < STEP * size || d > 2.5 * size) return;
        if (Math.hypot(b.x - cx, b.y - cy) <= Math.hypot(last.x - cx, last.y - cy)) return; // must move away
        if (d < bd) { bd = d; best = k; }
      });
      if (best < 0) continue;
      used.add(best);
      fl.pts.push({ t, x: blobs[best].x, y: blobs[best].y });
      // 3 points, now outside the robot, and fast: it left the robot
      const a = fl.pts[0], z = fl.pts[fl.pts.length - 1], c = centre(fl.box);
      // speed relative to the robot (its own driving taken out)
      const rel = Math.hypot((z.x - c.x) - (a.x - fl.c0.x), (z.y - c.y) - (a.y - fl.c0.y));
      const speed = rel / size / Math.max(1e-3, z.t - a.t);
      // launched balls go up (the hives are high); balls pushed along the floor or dropping in a hive don't
      const rising = fl.pts.slice(0, 3).every((p, i, q) => i === 0 || p.y < q[i - 1].y - 0.5)
        && (a.y - fl.c0.y) - (z.y - c.y) >= 0.5 * size;
      if (!fl.done && fl.pts.length >= 3 && !inside(z, grow(fl.box, NEAR)) && speed >= FAST && rising) fl.done = true;
      // reported once: as soon as it is strong, or when it ends weak (see below)
      if (fl.done && !fl.sent && fl.pts.length >= 4) {
        fl.sent = true;
        out.push({ t: a.t, robot: fl.robot, x: a.x * this.sx, y: a.y * this.sy, strong: false, kind: "flight" });
      }
    }
    // flights that left the robot but were lost after 3 frames: weak launches
    for (const fl of this.flights) {
      if (fl.done && !fl.sent && t - fl.pts[fl.pts.length - 1].t >= 0.25) {
        fl.sent = true;
        out.push({ t: fl.pts[0].t, robot: fl.robot, x: fl.pts[0].x * this.sx, y: fl.pts[0].y * this.sy, strong: false, kind: "flight" });
      }
    }
    // streaks near a robot (just above it or on it), each robot at most 4 per frame (a volley)
    const perRobot = new Map<number, number>();
    for (const st of streaks) {
      const low = st.y1; // lower end of the smear: nearest to where it came from
      // the smear's lower end over the robot, at most ~0.7 robot heights above its top (higher up
      // are the hives, where balls tip out, and the people behind the field)
      const r = rb.filter(r => inside({ x: st.x, y: low }, { x: r.box.x - r.box.w * 0.1, y: r.box.y - r.box.h * 0.7, w: r.box.w * 1.2, h: r.box.h * 1.0 }))
        .sort((p, q) => dist({ x: st.x, y: low }, centre(p.box)) - dist({ x: st.x, y: low }, centre(q.box)))[0];
      if (!r) continue;
      if ((low - r.box.y) / r.box.h > 0.1) continue; // starts below the robot's top: a ball it is carrying
      // the same ball smears again in the next frame, further up: not a new launch
      const recent = this.streakSeen.filter(q => q.robot === r.id && t - q.t < 0.35 && q.t < t);
      const again = recent.some(q => Math.hypot(st.x - q.x, st.y - q.y) < 3 * Math.max(r.box.w, r.box.h));
      this.streakSeen.push({ t, robot: r.id, x: st.x, y: st.y });
      if (again || (perRobot.get(r.id) ?? 0) >= 4) continue;
      perRobot.set(r.id, (perRobot.get(r.id) ?? 0) + 1);
      const prev = this.lastBox.get(r.id), size = Math.max(r.box.w, r.box.h);
      const rspeed = prev && t > prev.t ? dist(centre(prev.box), centre(r.box)) / size / (t - prev.t) : 0;
      this.pending.push({ sx: st.x, sy: st.y, len: st.len, t, falling: false, l: {
        t, robot: r.id, x: st.x * this.sx, y: st.y * this.sy, strong: true, kind: "streak",
        feat: { len: st.len, wid: st.wid, n: st.n, tilt: st.tilt, rel: (low - r.box.y) / r.box.h, rspeed, rsize: size },
      } });
    }
    this.streakSeen = this.streakSeen.filter(q => t - q.t < 1);
    for (const r of rb) this.lastBox.set(r.id, { t, box: r.box });
    out.push(...settled);

    // 2) start flights at robots
    blobs.forEach((b, k) => {
      if (used.has(k)) return;
      const r = rb.filter(r => inside(b, grow(r.box, NEAR)))
        .sort((p, q) => dist(b, centre(p.box)) - dist(b, centre(q.box)))[0];
      if (r) this.flights.push({ robot: r.id, box: r.box, c0: centre(r.box), pts: [{ t, x: b.x, y: b.y }], done: false, sent: false });
    });
    return out;
  }
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const grow = (b: Box, k: number): Box => ({ x: b.x - b.w * k, y: b.y - b.h * k, w: b.w * (1 + 2 * k), h: b.h * (1 + 2 * k) });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Connected blobs of a mask (4-neighbour), as centres; only ball-sized ones. */
function components(m: Uint8Array): { x: number; y: number; n: number }[] {
  const seen = new Uint8Array(m.length), out: { x: number; y: number; n: number }[] = [], stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    let n = 0, sx = 0, sy = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!, x = j % W, y = (j / W) | 0;
      n++; sx += x; sy += y;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= m.length || seen[k] || !m[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (n >= MIN_PX && n <= MAX_PX) out.push({ x: sx / n, y: sy / n, n });
  }
  // one ball can come out as 2-3 pieces: pieces a few pixels apart are one ball
  const merged: typeof out = [];
  for (const b of out.sort((p, q) => q.n - p.n)) {
    const m = merged.find(q => Math.hypot(q.x - b.x, q.y - b.y) < 6);
    if (m) { m.x = (m.x * m.n + b.x * b.n) / (m.n + b.n); m.y = (m.y * m.n + b.y * b.n) / (m.n + b.n); m.n += b.n; } else merged.push({ ...b });
  }
  return merged;
}

/** Connected shapes with their length and width (from second moments) and vertical extent. */
type Shape = { x: number; y: number; n: number; len: number; wid: number; y0: number; y1: number; tilt: number };
function shapes(m: Uint8Array): Shape[] {
  const seen = new Uint8Array(m.length), out: Shape[] = [], stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    const px: number[] = [], py: number[] = [];
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!, x = j % W, y = (j / W) | 0;
      px.push(x); py.push(y);
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= m.length || seen[k] || !m[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    const n = px.length;
    if (n < 6 || n > 400) continue;
    const mx = px.reduce((a, b) => a + b, 0) / n, my = py.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < n; k++) { const dx = px[k] - mx, dy = py[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = Math.sqrt(Math.max(0, (sxx - syy) ** 2 / 4 + sxy * sxy));
    const l1 = tr / 2 + det, l2 = Math.max(0.25, tr / 2 - det);
    // long axis angle from vertical, degrees (0 = straight up)
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // from the x axis
    const tilt = Math.round(90 - Math.abs(ang) * 180 / Math.PI);
    out.push({ x: mx, y: my, n, len: 4 * Math.sqrt(l1), wid: 4 * Math.sqrt(l2), y0: Math.min(...py), y1: Math.max(...py), tilt });
  }
  return out;
}
