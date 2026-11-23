import { useEffect, useRef, useState } from "react";
import { FIELD_FT, orderCorners, type Pt } from "../vision/field";
import { autoSegments, type PathPoint } from "../analysis/robotStats";
import { AUTO_COLOURS } from "./autoColours";

// Field mapping (one click per corner, once per event) and the top-down heatmap it enables.

const key = (event: string) => `ftcscout.field.${event}`;
export function savedCorners(event: string): Pt[] | null {
  try { const v = JSON.parse(localStorage.getItem(key(event)) ?? "null"); return Array.isArray(v) && v.length === 4 ? v : null; } catch { return null; }
}
function saveCorners(event: string, pts: Pt[] | null) {
  try { pts ? localStorage.setItem(key(event), JSON.stringify(pts)) : localStorage.removeItem(key(event)); } catch { /* private mode */ }
}

/** The camera picture; the user clicks the 4 corners of the field floor. Coordinates are 1280x720. */
export function FieldCorners({ event, title, thumb, onDone }: { event: string; title: string; thumb: string; onDone: (pts: Pt[] | null) => void }) {
  const [pts, setPts] = useState<Pt[]>(() => savedCorners(event) ?? []);
  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pts.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPts([...pts, { x: ((e.clientX - r.left) / r.width) * 1280, y: ((e.clientY - r.top) / r.height) * 720 }]);
  };
  const ordered = pts.length === 4 ? orderCorners(pts) : pts;
  return (
    <div className="field-corners">
      <p className="small">
        <b>{title}</b>: click the <b>4 corners of the field floor</b> (where the floor meets the walls), in any order.
        Use the corners even if a robot or a person covers one: click where it would be.
      </p>
      <div className="corner-pic" onClick={click}>
        <img src={thumb} alt="camera view of the field" />
        <svg viewBox="0 0 1280 720" preserveAspectRatio="none">
          {ordered.length === 4 && <polygon points={ordered.map(p => `${p.x},${p.y}`).join(" ")} className="corner-poly" />}
          {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={9} className="corner-dot" />)}
        </svg>
      </div>
      <div className="row">
        <button className="primary" disabled={pts.length !== 4} onClick={() => { saveCorners(event, pts); onDone(pts); }}>Save field</button>
        <button onClick={() => setPts([])}>Start over</button>
        <button onClick={() => onDone(savedCorners(event))}>Cancel</button>
        {savedCorners(event) && <button onClick={() => { saveCorners(event, null); onDone(null); }}>Remove mapping</button>}
        <span className="muted small">{pts.length}/4 corners</span>
      </div>
    </div>
  );
}

/** Auto paths on the field, seen from above (ft), one colour per match. */
export function FieldHeatmap({ title, series }: { title: string; series: { label: string; path: PathPoint[] }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, S = 360, k = S / FIELD_FT;
    c.width = S; c.height = S;
    const ctx = c.getContext("2d")!;
    const css = getComputedStyle(c);
    ctx.fillStyle = css.getPropertyValue("--field-floor").trim() || "#3a3d44";
    ctx.fillRect(0, 0, S, S);
    // 2 ft tiles
    ctx.strokeStyle = css.getPropertyValue("--field-grid").trim() || "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(i * 2 * k, 0); ctx.lineTo(i * 2 * k, S); ctx.moveTo(0, i * 2 * k); ctx.lineTo(S, i * 2 * k); ctx.stroke();
    }
    // field y grows away from the camera; draw the camera side at the bottom
    const X = (p: PathPoint) => p.x * k, Y = (p: PathPoint) => S - p.y * k;
    drawAuto(ctx, series, X, Y);
  }, [series]);
  return (
    <figure className="heatmap">
      <canvas ref={ref} className="field-canvas" aria-label={`Autonomous paths at ${title}, top-down`} />
      <figcaption>{title}: autonomous paths, top-down (camera side at the bottom, 2 ft tiles). Dot = where it started.
        <Legend series={series} /></figcaption>
    </figure>
  );
}

/** Auto paths: a line per gap-free piece, a dot where the robot started. */
export function drawAuto(ctx: CanvasRenderingContext2D, series: { path: PathPoint[] }[], X: (p: PathPoint) => number, Y: (p: PathPoint) => number) {
  ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
  series.forEach((s, i) => {
    const col = AUTO_COLOURS[i % AUTO_COLOURS.length];
    const segs = autoSegments(s.path);
    ctx.strokeStyle = col;
    for (const seg of segs) { ctx.beginPath(); seg.forEach((p, j) => (j ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.stroke(); }
    const first = segs[0]?.[0];
    if (first) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(first), Y(first), 5, 0, 2 * Math.PI); ctx.fill(); }
  });
}

export function Legend({ series }: { series: { label: string }[] }) {
  return (
    <span className="legend">
      {series.map((s, i) => <span key={s.label}><i style={{ background: AUTO_COLOURS[i % AUTO_COLOURS.length] }} />{s.label}</span>)}
    </span>
  );
}
