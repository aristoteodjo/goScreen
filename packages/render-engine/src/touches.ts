import { recordingSpans } from "./sequence";
import type { MainClip, RecordedPointer, TouchMark } from "./types";

/** Time for a ring to grow in when the finger lands. */
const PRESS = 0.12;
/** Time for a ring to expand and fade once the finger lifts. */
export const RELEASE = 0.45;
/** A press without a matching release still shows briefly. */
const ORPHAN_HOLD = 0.15;

export type Press = { pointer: RecordedPointer; down: number; up: number };

/** Pairs each down with the next up of the same device. */
export function presses(pointers: RecordedPointer[]): Press[] {
  const out: Press[] = [];
  const open = new Map<string, Press>();
  for (const p of pointers) {
    if (p.kind === "down") {
      const press = { pointer: p, down: p.t, up: p.t + ORPHAN_HOLD };
      open.set(p.instanceId, press);
      out.push(press);
    } else if (p.kind === "up") {
      const press = open.get(p.instanceId);
      if (press) {
        press.up = Math.max(press.down, p.t);
        open.delete(p.instanceId);
      }
    }
  }
  return out;
}

/**
 * Touch indicators visible at time t. Positions come from `map` (captured
 * region coords by default); unmappable presses are skipped.
 */
export function touchesAt(
  list: Press[],
  t: number,
  map: (p: RecordedPointer) => { x: number; y: number } | null = (p) => ({ x: p.x, y: p.y }),
): TouchMark[] {
  const out: TouchMark[] = [];
  for (const p of list) {
    if (t < p.down || t > p.up + RELEASE) continue;
    const at = map(p.pointer);
    if (!at) continue;
    if (t <= p.up) {
      const k = Math.min(1, (t - p.down) / PRESS);
      out.push({ ...at, scale: 0.6 + 0.4 * k, opacity: k });
    } else {
      const k = (t - p.up) / RELEASE;
      out.push({ ...at, scale: 1 + 0.6 * k, opacity: 1 - k });
    }
  }
  return out;
}

/** Tap times in timeline seconds, for click sound effects. Muted clips stay silent. */
export function tapTimes(pointers: RecordedPointer[], clips: MainClip[]): number[] {
  const out: number[] = [];
  for (const p of pointers) {
    if (p.kind !== "down") continue;
    for (const span of recordingSpans(clips)) {
      const c = span.clip;
      if (!c.muted && p.t >= c.in && p.t < c.out) out.push(span.start + (p.t - c.in) / c.speed);
    }
  }
  return out.sort((a, b) => a - b);
}
