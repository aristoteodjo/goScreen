import { pop } from "./look";
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
  map: (p: RecordedPointer) => { x: number; y: number } | null = (p) => ({
    x: p.x,
    y: p.y,
  }),
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

/** Seconds a ripple ring takes to expand and fade. */
export const RIPPLE = 0.5;
/** Two frames at 30 fps between the rings, the course's stagger. */
const RIPPLE_STAGGER = 2 / 30;
const RIPPLE_RINGS = 2;

/**
 * The course's click: a blurred ring that grows out of the press and fades,
 * then a second one two frames later. Marks carry `ring` (0 = the press
 * disc, 1.. = the rings); the disc is drawn like a solid touch.
 */
export function ripplesAt(
  list: Press[],
  t: number,
  map: (p: RecordedPointer) => { x: number; y: number } | null = (p) => ({
    x: p.x,
    y: p.y,
  }),
): TouchMark[] {
  const out: TouchMark[] = [];
  for (const p of list) {
    if (t < p.down || t > p.down + RIPPLE + RIPPLE_STAGGER * RIPPLE_RINGS)
      continue;
    const at = map(p.pointer);
    if (!at) continue;
    if (t <= p.up) {
      const k = Math.min(1, (t - p.down) / PRESS);
      out.push({ ...at, scale: 0.5 + 0.3 * k, opacity: 0.8 * k, ring: 0 });
    } else if (t <= p.up + 0.1) {
      out.push({ ...at, scale: 0.8, opacity: 0.8 * (1 - (t - p.up) / 0.1), ring: 0 });
    }
    for (let r = 1; r <= RIPPLE_RINGS; r += 1) {
      const local = t - p.down - RIPPLE_STAGGER * (r - 1);
      if (local < 0 || local > RIPPLE) continue;
      const k = local / RIPPLE;
      // Grows fast then slows; fades in over the first fifth, out after.
      const grow = 1 - (1 - k) ** 2.2;
      const alpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      out.push({
        ...at,
        scale: 0.8 + 1.8 * grow,
        opacity: alpha * (r === 1 ? 1 : 0.6),
        ring: r,
      });
    }
  }
  return out;
}

/** How long the spotlight of a click lasts, and its fades. */
export const SPOTLIGHT = 1.3;
const SPOT_IN = 0.12;
const SPOT_OUT = 0.45;

export type Spotlight = { x: number; y: number; strength: number };

/**
 * The course's "dim the rest": around a click, everything but a soft disc
 * on the target darkens for a moment. Strength 0..1 at time t, at the
 * latest click's spot (clicks in a burst keep the light on).
 */
export function spotlightAt(
  list: Press[],
  t: number,
  map: (p: RecordedPointer) => { x: number; y: number } | null,
): Spotlight | null {
  let best: Spotlight | null = null;
  for (const p of list) {
    const local = t - p.down;
    if (local < 0 || local > SPOTLIGHT) continue;
    const at = map(p.pointer);
    if (!at) continue;
    const strength =
      local < SPOT_IN
        ? local / SPOT_IN
        : local > SPOTLIGHT - SPOT_OUT
          ? (SPOTLIGHT - local) / SPOT_OUT
          : 1;
    if (!best || p.down > t - local) best = { ...at, strength };
  }
  return best;
}

/** The instance id of a flat video presented as one glass: every click counts. */
export const FLAT = "flat";

/** Seconds a click's punch on the screen lasts. */
export const PUNCH = 0.5;

/**
 * The screen reacts to a click: it dips a little and bounces back with the
 * course's 50-amplitude button press, scaled down for a whole screen.
 * A scale factor (1 = at rest) for this device at time t.
 */
export function pressPunch(
  list: Press[],
  t: number,
  instanceId: string,
  strength = 0.02,
): number {
  let factor = 1;
  for (const p of list) {
    if (instanceId !== FLAT && p.pointer.instanceId !== instanceId) continue;
    const local = t - p.down;
    if (local < 0 || local > PUNCH) continue;
    factor *= 1 - strength * (1 - pop(local, 50));
  }
  return factor;
}

/** Tap times in timeline seconds, for click sound effects. Muted clips stay silent. */
export function tapTimes(
  pointers: RecordedPointer[],
  clips: MainClip[],
): number[] {
  const out: number[] = [];
  for (const p of pointers) {
    if (p.kind !== "down") continue;
    for (const span of recordingSpans(clips)) {
      const c = span.clip;
      if (!c.muted && p.t >= c.in && p.t < c.out)
        out.push(span.start + (p.t - c.in) / c.speed);
    }
  }
  return out.sort((a, b) => a - b);
}
