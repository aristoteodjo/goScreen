import type { Press } from "./touches";
import type { Point, RecordedPointer } from "./types";

export type CursorMark = Point & {
  /** 0 = up, 1 = pressed: the arrow shrinks a little on a click. */
  pressed: number;
};

/** Samples further apart than this are a jump (another device, a pause): no glide. */
const MAX_GLIDE = 0.5;
/** Window averaged to remove hand jitter; adds about half of it as lag. */
const SMOOTH = 0.12;
const SMOOTH_STEPS = 5;
const PRESS_IN = 0.06;
const PRESS_OUT = 0.15;

/** Index of the last sample at or before t (pointers are in time order). */
function lastAt(pointers: RecordedPointer[], t: number): number {
  let lo = 0;
  let hi = pointers.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pointers[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Raw position at t, eased between two samples of the same device. */
function rawAt(
  pointers: RecordedPointer[],
  t: number,
  map: (p: RecordedPointer) => Point | null,
): Point | null {
  const i = lastAt(pointers, t);
  if (i < 0) return null;
  const a = map(pointers[i]);
  if (!a) return null;
  const next = pointers[i + 1];
  if (
    !next ||
    next.instanceId !== pointers[i].instanceId ||
    next.t - pointers[i].t > MAX_GLIDE
  )
    return a;
  const b = map(next);
  if (!b) return a;
  const k = (t - pointers[i].t) / (next.t - pointers[i].t || 1);
  const e = k * k * (3 - 2 * k);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

/**
 * The synthetic mouse cursor at time t, in output space through `map`.
 * It appears with the first pointer sample and stays at the last known spot.
 */
export function cursorAt(
  pointers: RecordedPointer[],
  presses: Press[],
  t: number,
  map: (p: RecordedPointer) => Point | null,
): CursorMark | null {
  const here = rawAt(pointers, t, map);
  if (!here) return null;
  let x = 0;
  let y = 0;
  let n = 0;
  for (let s = 0; s < SMOOTH_STEPS; s++) {
    const at = rawAt(pointers, t - (SMOOTH * s) / (SMOOTH_STEPS - 1), map);
    if (!at) break;
    x += at.x;
    y += at.y;
    n++;
  }
  // A click lands exactly where it was recorded: no smoothing while pressed.
  let pressed = 0;
  for (const p of presses) {
    if (t < p.down || t > p.up + PRESS_OUT) continue;
    pressed = Math.max(
      pressed,
      t <= p.up
        ? Math.min(1, (t - p.down) / PRESS_IN)
        : 1 - (t - p.up) / PRESS_OUT,
    );
  }
  const smooth = { x: x / n, y: y / n };
  return {
    x: smooth.x + (here.x - smooth.x) * pressed,
    y: smooth.y + (here.y - smooth.y) * pressed,
    pressed,
  };
}
