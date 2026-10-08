import type { RecordedPointer, ZoomSegment } from "./types";

/**
 * Suggests zoom segments from the taps of a fresh recording (Smart Camera).
 * Runs once when a recording is first opened; the user can then move,
 * resize or delete every segment, so automation never locks the project.
 *
 * Contract:
 * - segments are sorted, inside [0, duration], never overlap, and each lasts
 *   at least MIN_SEGMENT (0.4s, see timeline.ts);
 * - `focus: null` lets the camera follow the taps inside the segment;
 * - ids must be unique (e.g. `auto-${index}`).
 */
export function buildAutoZooms(pointers: RecordedPointer[], duration: number): ZoomSegment[] {
  // TODO(you): decide which taps deserve a zoom and how they are grouped.
  void pointers;
  void duration;
  return [];
}
