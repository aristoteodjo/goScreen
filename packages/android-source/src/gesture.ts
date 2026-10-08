import type { AndroidInput } from "./model";

type Sample = { x: number; y: number; t: number };
type Size = { width: number; height: number };

/** Below this travel (element px) a press is a tap, not a swipe. */
const SLOP = 10;
/** A still press held this long becomes a long press. */
const LONG_PRESS_MS = 450;

/** Element-local CSS px -> native device px. */
export function toDevicePixels(p: { x: number; y: number }, element: Size, native: Size) {
  const clamp = (v: number, max: number) => Math.round(Math.min(max - 1, Math.max(0, v)));
  return {
    x: clamp((p.x / Math.max(1, element.width)) * native.width, native.width),
    y: clamp((p.y / Math.max(1, element.height)) * native.height, native.height),
  };
}

/** Classifies a press into what `adb shell input` should replay. */
export function gestureFrom(down: Sample, up: Sample, element: Size, native: Size): AndroidInput {
  const a = toDevicePixels(down, element, native);
  const b = toDevicePixels(up, element, native);
  const travel = Math.hypot(up.x - down.x, up.y - down.y);
  const durationMs = Math.round(Math.max(0, up.t - down.t));
  if (travel < SLOP) {
    // A swipe that goes nowhere is how adb spells long press.
    return durationMs >= LONG_PRESS_MS
      ? { kind: "swipe", x1: a.x, y1: a.y, x2: a.x, y2: a.y, durationMs }
      : { kind: "tap", x: a.x, y: a.y };
  }
  return { kind: "swipe", x1: a.x, y1: a.y, x2: b.x, y2: b.y, durationMs: Math.min(3000, Math.max(80, durationMs)) };
}
