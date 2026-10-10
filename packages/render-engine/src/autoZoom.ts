import { MIN_SEGMENT } from "./timeline";
import type { RecordedPointer, ZoomSegment } from "./types";

/** Clicks closer than this belong to the same action (fill a form, open a menu). */
const GROUP_GAP = 2.5;
/** The camera arrives before the first click... */
const LEAD = 0.6;
/** ...and stays a little after the last one, so the result is seen. */
const TAIL = 1.4;
/** Close enough to read a button, far enough to keep its context. */
export const AUTO_SCALE = 1.8;
/** Two segments this close are merged: no zoom out / zoom in flicker. */
const MERGE_GAP = 0.8;

/**
 * Suggests zoom segments from the clicks of a recording (Smart Camera).
 * Runs once when a recording is first opened, or on demand; the user can then
 * move, resize or delete every segment, so automation never locks the project.
 *
 * - segments are sorted, inside [0, duration], never overlap, and each lasts
 *   at least MIN_SEGMENT;
 * - `focus: null` lets the camera follow the pointer inside the segment;
 * - scrolling and plain mouse moves never zoom: only clicks are actions.
 */
export function buildAutoZooms(
  pointers: RecordedPointer[],
  duration: number,
): ZoomSegment[] {
  const clicks = pointers
    .filter((p) => p.kind === "down" && p.t >= 0 && p.t <= duration)
    .map((p) => p.t)
    .sort((a, b) => a - b);

  const spans: { start: number; end: number }[] = [];
  for (const t of clicks) {
    const start = Math.max(0, t - LEAD);
    const end = Math.min(duration, t + TAIL);
    const last = spans.at(-1);
    if (
      last &&
      start - last.end <= Math.max(MERGE_GAP, GROUP_GAP - LEAD - TAIL)
    )
      last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }

  return spans
    .filter((s) => s.end - s.start >= MIN_SEGMENT)
    .map((s, i) => ({ id: `auto-${i}`, ...s, scale: AUTO_SCALE, focus: null }));
}
