import { sharp } from "./look";
import type {
  Camera,
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

/** Output pixel -> screen pixel under a camera. */
export function applyCamera(camera: Camera, output: Size, p: Point): Point {
  return {
    x: (p.x - camera.center.x) * camera.scale + output.width / 2,
    y: (p.y - camera.center.y) * camera.scale + output.height / 2,
  };
}
