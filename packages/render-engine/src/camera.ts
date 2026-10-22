import { sharp } from "./look";
import type {
  Camera,
  CameraDrift,
  Point,
  RecordedPointer,
  Size,
  ZoomSegment,
} from "./types";

/** Seconds spent easing out of a zoom (the way in is faster: see ZOOM_IN). */
export const ZOOM_RAMP = 0.7;
/** The way in "pops right in": full speed at once, then a long deceleration. */
export const ZOOM_IN = 0.5;
/** The camera never stands still: it keeps pushing in by this much over a zoom. */
export const ZOOM_DRIFT = 0.04;
/** How long the camera takes to glide from one tap to the next. */
const FOLLOW_GLIDE = 0.5;

export const easeInOut = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 0 outside the segment, 1 on its plateau: a sharp way in (the course's
 * "pop right in" speed graph) and a smooth way out.
 */
export function zoomAmount(seg: ZoomSegment, t: number): number {
  if (t <= seg.start || t >= seg.end) return 0;
  const half = (seg.end - seg.start) / 2;
  const rampIn = Math.min(ZOOM_IN, half);
  const rampOut = Math.min(ZOOM_RAMP, half);
  return Math.min(
    sharp((t - seg.start) / rampIn),
    easeInOut((seg.end - t) / rampOut),
  );
}

/** Momentum: how far the slow push-in has gone over the segment (0..1). */
export function zoomDrift(seg: ZoomSegment, t: number): number {
  const length = seg.end - seg.start;
  if (length <= 0) return 0;
  return Math.max(0, Math.min(1, (t - seg.start) / length));
}

export function activeZoom(
  zooms: ZoomSegment[],
  t: number,
): ZoomSegment | null {
  return zooms.find((z) => t > z.start && t < z.end) ?? null;
}

const identity = (p: RecordedPointer): Point => ({ x: p.x, y: p.y });

/**
 * Where an automatic zoom looks at time t: the latest tap, gliding toward
 * the next one shortly before it happens. `map` places a tap in the space
 * the caller wants (output pixels for the composer).
 */
export function autoFocus(
  pointers: RecordedPointer[],
  seg: ZoomSegment,
  t: number,
  map: (p: RecordedPointer) => Point | null = identity,
): Point | null {
  const downs = pointers
    .filter(
      (p) =>
        p.kind === "down" && p.t >= seg.start - ZOOM_RAMP && p.t <= seg.end,
    )
    .flatMap((p) => {
      const at = map(p);
      return at ? [{ t: p.t, ...at }] : [];
    });
  if (downs.length === 0) return null;
  let i = 0;
  while (i + 1 < downs.length && downs[i + 1].t <= t) i += 1;
  const here = downs[i];
  const next = downs[i + 1];
  if (!next || here.t > t) return { x: here.x, y: here.y };
  const k = sharp((t - (next.t - FOLLOW_GLIDE)) / FOLLOW_GLIDE);
  return { x: lerp(here.x, next.x, k), y: lerp(here.y, next.y, k) };
}

/**
 * Camera over the output frame. `focus` is in output pixels; the visible
 * window is clamped so the camera never shows outside the frame.
 */
export function cameraAt(
  seg: ZoomSegment | null,
  t: number,
  output: Size,
  focus: Point | null,
): Camera {
  const middle = { x: output.width / 2, y: output.height / 2 };
  if (!seg) return { scale: 1, center: middle };
  const amount = zoomAmount(seg, t);
  // The plateau is not flat: the camera keeps pushing in a little.
  const target = seg.scale * (1 + ZOOM_DRIFT * zoomDrift(seg, t));
  const scale = lerp(1, target, amount);
  const aim = focus ?? middle;
  const halfW = output.width / (2 * scale);
  const halfH = output.height / (2 * scale);
  const center = {
    x: Math.min(
      output.width - halfW,
      Math.max(halfW, lerp(middle.x, aim.x, amount)),
    ),
    y: Math.min(
      output.height - halfH,
      Math.max(halfH, lerp(middle.y, aim.y, amount)),
    ),
  };
  return { scale, center };
}

/** The drift the premium look switches on: 3 % push and a 1.5 % pan. */
export const DEFAULT_DRIFT: CameraDrift = { scale: 0.03, pan: 0.015 };

/** Where the drift stands at this moment: extra scale and pan (fractions). */
export type DriftState = { scale: number; dx: number; dy: number };

/**
 * The camera's permanent drift `k` of the way through a scene (0..1): it
 * pushes in to `1 + drift.scale` and pans by `drift.pan` of the width,
 * decelerating (never linear) so it never ends on a jolt. `side` flips the
 * pan so two scenes in a row never travel the same way.
 */
export function driftState(
  drift: CameraDrift | undefined,
  k: number,
  side = 1,
): DriftState {
  if (!drift || (drift.scale === 0 && drift.pan === 0))
    return { scale: 1, dx: 0, dy: 0 };
  const c = Math.max(0, Math.min(1, k));
  const e = c * (2 - c);
  return {
    scale: 1 + drift.scale * e,
    dx: drift.pan * (e - 0.5) * side,
    // A touch of vertical travel, a third of the pan, the other way.
    dy: -drift.pan * (e - 0.5) * side * 0.33,
  };
}

/**
 * A camera with a drift folded in: the push multiplies the scale, the pan
 * moves the centre; the window still never shows outside the frame.
 */
export function withDrift(
  camera: Camera,
  drift: DriftState,
  output: Size,
): Camera {
  if (drift.scale === 1 && drift.dx === 0 && drift.dy === 0) return camera;
  const scale = camera.scale * drift.scale;
  const halfW = output.width / (2 * scale);
  const halfH = output.height / (2 * scale);
  return {
    scale,
    center: {
      x: Math.min(
        output.width - halfW,
        Math.max(halfW, camera.center.x + drift.dx * output.width),
      ),
      y: Math.min(
        output.height - halfH,
        Math.max(halfH, camera.center.y + drift.dy * output.height),
      ),
    },
  };
}

/** Output pixel -> screen pixel under a camera. */
export function applyCamera(camera: Camera, output: Size, p: Point): Point {
  return {
    x: (p.x - camera.center.x) * camera.scale + output.width / 2,
    y: (p.y - camera.center.y) * camera.scale + output.height / 2,
  };
}
