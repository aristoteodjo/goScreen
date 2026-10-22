import type { Point } from "./types";

// Corners in order: top-left, top-right, bottom-right, bottom-left.
export type Quad = [Point, Point, Point, Point];

/**
 * Projective map from the unit square onto a quad (Heckbert). A device
 * rendered with perspective tilt projects its screen to an arbitrary quad;
 * this turns a point in screen space into its position on the stage.
 */
export function quadMapper(quad: Quad): (u: number, v: number) => Point {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let g = 0;
  let h = 0;
  const det = dx1 * dy2 - dx2 * dy1;
  if ((Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) && Math.abs(det) > 1e-12) {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;

  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/**
 * The inverse map: a point of the output back to the unit square of the
 * quad (u, v may fall outside 0..1 when the point is off the quad). Null
 * when the quad is degenerate.
 */
export function quadInverse(
  quad: Quad,
): ((p: Point) => { u: number; v: number }) | null {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  const det = dx1 * dy2 - dx2 * dy1;
  if ((Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) && Math.abs(det) > 1e-12) {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  // Forward matrix [a b c; d e f; g h 1] from (u, v, 1) to (x w, y w, w).
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;
  // Adjugate of the forward matrix (a scale factor cancels in the division).
  const A = e - f * h;
  const B = c * h - b;
  const C = b * f - c * e;
  const D = f * g - d;
  const E = a - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const scale = a * A + b * D + c * G;
  if (Math.abs(scale) < 1e-12) return null;
  return (p) => {
    const w = G * p.x + H * p.y + I;
    if (Math.abs(w) < 1e-12) return { u: Number.NaN, v: Number.NaN };
    return {
      u: (A * p.x + B * p.y + C) / w,
      v: (D * p.x + E * p.y + F) / w,
    };
  };
}
