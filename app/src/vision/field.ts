// Camera image → field floor, in feet. The field is a 12 x 12 ft square of 2 ft tiles; once its
// 4 corners are known on the camera picture, a homography maps any floor point (e.g. the bottom
// of a robot's box) to where it is on the field, whatever the camera angle.

export const FIELD_FT = 12;

export type Pt = { x: number; y: number };
export type Homography = number[]; // 3x3, row-major

/** Corners in a fixed order: clockwise, starting with the one nearest the image's bottom-left. */
export function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  // image y points down, so increasing atan2 = clockwise on screen
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const first = byAngle.reduce((bi, p, i) => (p.y - p.x > byAngle[bi].y - byAngle[bi].x ? i : bi), 0);
  return [...byAngle.slice(first), ...byAngle.slice(0, first)];
}

/** Homography taking the 4 image corners (ordered) to the field square (0,0)-(12,12) ft. */
export function fieldHomography(corners: Pt[]): Homography | null {
  const c = orderCorners(corners);
  // bottom-left, top-left, top-right, bottom-right on screen → field corners
  const dst: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: FIELD_FT }, { x: FIELD_FT, y: FIELD_FT }, { x: FIELD_FT, y: 0 }];
  return solve(c, dst);
}

export function toField(h: Homography, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Standard 4-point homography: 8 equations, h33 = 1, Gaussian elimination. */
function solve(src: Pt[], dst: Pt[]): Homography | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-9) return null; // 3 corners in a line: not a field
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const k = A[r][col] / A[col][col];
      for (let c = col; c < 9; c++) A[r][c] -= k * A[col][c];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}
