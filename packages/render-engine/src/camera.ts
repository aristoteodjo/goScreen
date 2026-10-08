import type { Camera, Point, RecordedPointer, Size, ZoomSegment } from "./types";

/** Seconds spent easing into and out of a zoom. */
export const ZOOM_RAMP = 0.7;
/** How long the camera takes to glide from one tap to the next. */
const FOLLOW_GLIDE = 0.5;

export const easeInOut = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** 0 outside the segment, 1 on its plateau, eased in between. */
export function zoomAmount(seg: ZoomSegment, t: number): number {
  if (t <= seg.start || t >= seg.end) return 0;
  const ramp = Math.min(ZOOM_RAMP, (seg.end - seg.start) / 2);
  return Math.min(easeInOut((t - seg.start) / ramp), easeInOut((seg.end - t) / ramp));
}

export function activeZoom(zooms: ZoomSegment[], t: number): ZoomSegment | null {
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
    .filter((p) => p.kind === "down" && p.t >= seg.start - ZOOM_RAMP && p.t <= seg.end)
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
  const k = easeInOut((t - (next.t - FOLLOW_GLIDE)) / FOLLOW_GLIDE);
  return { x: lerp(here.x, next.x, k), y: lerp(here.y, next.y, k) };
}

/**
 * Camera over the output frame. `focus` is in output pixels; the visible
 * window is clamped so the camera never shows outside the frame.
 */
export function cameraAt(seg: ZoomSegment | null, t: number, output: Size, focus: Point | null): Camera {
  const middle = { x: output.width / 2, y: output.height / 2 };
  if (!seg) return { scale: 1, center: middle };
  const amount = zoomAmount(seg, t);
  const scale = lerp(1, seg.scale, amount);
  const target = focus ?? middle;
  const halfW = output.width / (2 * scale);
  const halfH = output.height / (2 * scale);
  const center = {
    x: Math.min(output.width - halfW, Math.max(halfW, lerp(middle.x, target.x, amount))),
    y: Math.min(output.height - halfH, Math.max(halfH, lerp(middle.y, target.y, amount))),
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
