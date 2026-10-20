// How recorded screens are presented, after the SaaS motion-design playbook
// ("enhanced screen recording"): a frosted plate and a thin outline around a
// frameless screen, the whole thing leaning in perspective with a slow drift,
// blurred where it is far from the camera, and popping in from below when a
// scene opens. Everything here is a pure function of time.

import { cubicBezier } from "./animation";
import type { Quad } from "./homography";
import { spring, type SpringConfig } from "./keyframes";
import type { Point, Size } from "./types";

export type ScreenLook = {
  // Frosted plate around a frameless screen: its margin as a fraction of the
  // screen's short side (0 = none).
  plate: number;
  // Outline width in px at a 1080p reference (0 = none); `sweep` turns its
  // gradient slowly over the scene instead of a flat 50 % grey.
  outline: number;
  sweep: boolean;
  // Perspective tilt in degrees. x > 0 leans the top away (seen from below);
  // y > 0 turns the right edge away.
  tilt: { x: number; y: number };
  // Degrees the orientation drifts over a scene (0 = still).
  drift: number;
  // Depth of field: how blurred the far edge gets (0..1).
  depth: number;
  // A scene opens with the screen popping in from below.
  entrance: boolean;
};

/** Flat, as goScreen always drew screens. */
export const DEFAULT_LOOK: ScreenLook = {
  plate: 0,
  outline: 0,
  sweep: false,
  tilt: { x: 0, y: 0 },
  drift: 0,
  depth: 0,
  entrance: false,
};

/** The course's screen: glass plate, 3 px outline, three-quarter view, DoF, pan in. */
export const PREMIUM_LOOK: ScreenLook = {
  plate: 0.035,
  outline: 3,
  sweep: true,
  tilt: { x: 8, y: -10 },
  drift: 3,
  depth: 0.4,
  entrance: true,
};

export const LOOK_PRESETS: { id: string; label: string; look: ScreenLook }[] = [
  { id: "flat", label: "Flat", look: DEFAULT_LOOK },
  { id: "premium", label: "Premium", look: PREMIUM_LOOK },
  {
    id: "glass",
    label: "Glass, no tilt",
    look: { ...PREMIUM_LOOK, tilt: { x: 0, y: 0 }, drift: 0, depth: 0 },
  },
  {
    id: "tilted",
    label: "Tilted, no plate",
    look: { ...PREMIUM_LOOK, plate: 0, outline: 0, sweep: false },
  },
];

/**
 * The course's "sharp" speed graph: full speed at once, then a long
 * deceleration ("pop right in"). Never linear.
 */
export const SHARP: [number, number, number, number] = [0.1, 0.9, 0.2, 1];
export const sharp = (x: number) => cubicBezier(SHARP, x);

/** Accelerating exit: slow start, fast end (sliding out, comets). */
export const SHARP_OUT: [number, number, number, number] = [0.7, 0, 0.9, 0.2];
export const sharpOut = (x: number) => cubicBezier(SHARP_OUT, x);

/**
 * The "4 frames + Bouncer" pop: the value reaches its target in about 4
 * frames at 30 fps (0.13 s) and overshoots it by `amplitude` % before
 * settling, like the course's amplitude-25 default (30 for wide gestures,
 * 50 for a button press).
 */
export function popSpring(amplitude = 25): SpringConfig {
  const over = Math.max(0.01, Math.min(0.9, amplitude / 100));
  const ln = Math.log(over);
  const zeta = -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
  // First crossing of the target at ~0.133 s, so the first peak at ~0.2 s.
  const wd = Math.PI / 0.2;
  const w0 = wd / Math.sqrt(1 - zeta * zeta);
  return {
    mass: 1,
    stiffness: w0 * w0,
    damping: 2 * zeta * w0,
    overshootClamping: false,
  };
}

/** 0 -> 1 with the pop above, `t` seconds after it starts. */
export function pop(t: number, amplitude = 25): number {
  return spring(t, popSpring(amplitude));
}

/** Seconds a scene's opening pan-in takes. */
export const ENTRANCE = 0.6;

export type Pose = {
  // Vertical offset as a fraction of the output height (positive = lower).
  dy: number;
  // Extra lean (degrees) added to the look's x tilt.
  tiltX: number;
  scale: number;
  opacity: number;
};

export const AT_REST: Pose = { dy: 0, tiltX: 0, scale: 1, opacity: 1 };

/**
 * The screen `local` seconds into a scene: it starts lower, leaning back
 * and slightly smaller, and pops right in with the sharp curve.
 */
export function entranceAt(local: number): Pose {
  if (local >= ENTRANCE) return AT_REST;
  if (local <= 0) return { dy: 0.14, tiltX: -28, scale: 0.9, opacity: 0 };
  const p = sharp(local / ENTRANCE);
  return {
    dy: (1 - p) * 0.14,
    tiltX: (1 - p) * -28,
    scale: 0.9 + 0.1 * p,
    opacity: Math.min(1, local / 0.12),
  };
}

/**
 * Orientation drift over a scene: the screen keeps turning a little after
 * it has arrived, never standing still (degrees added to the y tilt).
 */
export function driftAt(local: number, length: number, drift: number): number {
  if (drift === 0 || length <= 0) return 0;
  const k = Math.max(0, Math.min(1, local / Math.max(2, length)));
  return drift * (k - 0.5);
}

/** The outline's gradient angle (degrees) over a scene: 90 -> 19, as in the course. */
export function sweepAngle(local: number, length: number): number {
  const k = Math.max(0, Math.min(1, local / Math.max(2, length)));
  return 90 - 71 * k;
}

/** Focal length of the virtual camera: a 50 mm-ish lens over the frame. */
export const focalLength = (output: Size) =>
  1.3 * Math.max(output.width, output.height);

export type Projected = { quad: Quad; z: [number, number, number, number] };

/**
 * A rectangle of `size` (output px) centred on `center`, turned by `rotation`
 * (radians, in the plane), leaned by `tilt` (degrees) and seen through a
 * pinhole of focal length `focal`: its four corners on the output (top-left,
 * top-right, bottom-right, bottom-left) and their depth (px, positive = far).
 */
export function projectRect(
  center: Point,
  size: Size,
  rotation: number,
  tilt: { x: number; y: number },
  focal: number,
): Projected {
  const ax = (-tilt.x * Math.PI) / 180;
  const ay = (-tilt.y * Math.PI) / 180;
  const cz = Math.cos(rotation);
  const sz = Math.sin(rotation);
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const corners: [number, number][] = [
    [-size.width / 2, -size.height / 2],
    [size.width / 2, -size.height / 2],
    [size.width / 2, size.height / 2],
    [-size.width / 2, size.height / 2],
  ];
  const quad: Point[] = [];
  const z: number[] = [];
  for (const [x0, y0] of corners) {
    // In-plane rotation, then lean about x, then turn about y.
    const x1 = x0 * cz - y0 * sz;
    const y1 = x0 * sz + y0 * cz;
    const y2 = y1 * cx;
    const z2 = y1 * sx;
    const x3 = x1 * cy + z2 * sy;
    const z3 = z2 * cy - x1 * sy;
    const k = focal / Math.max(1e-3, focal + z3);
    quad.push({ x: center.x + x3 * k, y: center.y + y2 * k });
    z.push(z3 === 0 ? 0 : z3);
  }
  return {
    quad: quad as Quad,
    z: z as [number, number, number, number],
  };
}

/** Whether a point lies inside a convex quad (corners in order). */
export function insideQuad(quad: Quad, p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Axis-aligned bounds of a quad. */
export function quadBounds(quad: Quad) {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export const isFlat = (look: ScreenLook) =>
  look.tilt.x === 0 && look.tilt.y === 0 && look.drift === 0;

/** The look needs the warped (perspective) path rather than plain 2D drawing. */
export function needsWarp(look: ScreenLook, pose: Pose): boolean {
  return !isFlat(look) || pose.tiltX !== 0;
}
