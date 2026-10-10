import type { ZoomSegment } from "./types";

export const MIN_SEGMENT = 0.4;

export function formatTime(seconds: number, precise = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (!precise) return `${m}:${String(Math.floor(rest)).padStart(2, "0")}`;
  const whole = Math.floor(rest);
  const cents = Math.floor((rest - whole) * 100);
  return `${m}:${String(whole).padStart(2, "0")}.${String(cents).padStart(2, "0")}`;
}

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** Seconds between labelled ruler ticks so labels stay at least `minPx` apart. */
export function rulerStep(pxPerSecond: number, minPx = 72): number {
  return STEPS.find((s) => s * pxPerSecond >= minPx) ?? STEPS[STEPS.length - 1];
}

const sorted = (zooms: ZoomSegment[]) =>
  [...zooms].sort((a, b) => a.start - b.start);

/** Free gap around t on the zoom track, or null when t sits on a segment. */
export function freeGap(
  zooms: ZoomSegment[],
  t: number,
  duration: number,
): { start: number; end: number } | null {
  let start = 0;
  let end = duration;
  for (const z of sorted(zooms)) {
    if (t >= z.start && t <= z.end) return null;
    if (z.end <= t) start = Math.max(start, z.end);
    if (z.start >= t) end = Math.min(end, z.start);
  }
  return end - start >= MIN_SEGMENT ? { start, end } : null;
}

/** A new zoom of `length` seconds centered on t, shrunk to fit its gap. */
export function placeZoom(
  zooms: ZoomSegment[],
  t: number,
  duration: number,
  length = 2.5,
): { start: number; end: number } | null {
  const gap = freeGap(zooms, t, duration);
  if (!gap) return null;
  const len = Math.min(length, gap.end - gap.start);
  const start = Math.min(Math.max(gap.start, t - len / 2), gap.end - len);
  return { start, end: start + len };
}

/**
 * Clamps a proposed [start, end] for segment `id` between its neighbours.
 * `mode` says which edge the user is dragging; "move" keeps the length.
 */
export function constrainSegment(
  zooms: ZoomSegment[],
  id: string,
  start: number,
  end: number,
  duration: number,
  mode: "move" | "start" | "end",
): { start: number; end: number } {
  const others = sorted(zooms.filter((z) => z.id !== id));
  const self = zooms.find((z) => z.id === id);
  const anchor = self ? (self.start + self.end) / 2 : (start + end) / 2;
  const lo = Math.max(
    0,
    ...others.filter((z) => z.end <= anchor).map((z) => z.end),
  );
  const hi = Math.min(
    duration,
    ...others.filter((z) => z.start >= anchor).map((z) => z.start),
  );
  if (mode === "move") {
    const len = Math.min(end - start, hi - lo);
    const s = Math.min(Math.max(lo, start), hi - len);
    return { start: s, end: s + len };
  }
  if (mode === "start") {
    return { start: Math.min(Math.max(lo, start), end - MIN_SEGMENT), end };
  }
  return { start, end: Math.max(Math.min(hi, end), start + MIN_SEGMENT) };
}
