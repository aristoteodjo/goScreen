// Keyframes and text animators, the After Effects way, as pure functions of
// time: preview, scrubbing and export always draw the same frame.

import { spring } from "./keyframes";
import type {
  AnimProp,
  Ease,
  Keyframe,
  Overlay,
  PropertyTracks,
  TextAnimator,
  UnitState,
} from "./types";

export const ANIM_PROPS: AnimProp[] = [
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
  "blur",
];

/** Named curves as cubic Béziers (same numbers as CSS). */
export const EASE_CURVES: Record<
  "in" | "out" | "in-out" | "back",
  [number, number, number, number]
> = {
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  "in-out": [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1],
};

/** y of a CSS cubic-bezier at x (Newton, then bisection when it stalls). */
export function cubicBezier(
  [x1, y1, x2, y2]: [number, number, number, number],
  x: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) =>
    3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
  const by = (t: number) =>
    3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
  const dx = (t: number) =>
    3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2);
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bx(t) - x;
    if (Math.abs(err) < 1e-6) return by(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let [lo, hi] = [0, 1];
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = bx(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

/** Progress 0..1 -> eased progress (may overshoot for back/elastic/spring). */
export function eased(ease: Ease, x: number): number {
  const p = Math.max(0, Math.min(1, x));
  if (typeof ease === "object") return cubicBezier(ease.bezier, p);
  switch (ease) {
    case "linear":
      return p;
    case "hold":
      return p >= 1 ? 1 : 0;
    case "elastic":
      return p === 0 || p === 1
        ? p
        : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    case "spring":
      // A lively spring, fitted to the segment (settled by its end).
      return p >= 1 ? 1 : spring(p * 1.1, { damping: 12, stiffness: 180 });
    default:
      return cubicBezier(EASE_CURVES[ease], p);
  }
}

const sorted = (keys: Keyframe[]) => [...keys].sort((a, b) => a.t - b.t);

/** A track's value at `t` (seconds from the overlay start). */
export function valueAt(keys: Keyframe[], t: number): number | null {
  if (keys.length === 0) return null;
  const k = sorted(keys);
  if (t <= k[0].t) return k[0].value;
  const last = k[k.length - 1];
  if (t >= last.t) return last.value;
  let i = 0;
  while (i < k.length - 2 && t >= k[i + 1].t) i++;
  const [a, b] = [k[i], k[i + 1]];
  const span = b.t - a.t;
  if (span <= 0) return b.value;
  return a.value + (b.value - a.value) * eased(a.ease, (t - a.t) / span);
}

export type OverlayProps = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  blur: number;
};

/** The overlay's properties at timeline time t: keyframes win over fields. */
export function propsAt(o: Overlay, t: number): OverlayProps {
  const local = t - o.start;
  const tracks: PropertyTracks = o.keyframes ?? {};
  const pick = (p: AnimProp, base: number) => {
    const keys = tracks[p];
    return keys && keys.length > 0 ? (valueAt(keys, local) ?? base) : base;
  };
  return {
    x: pick("x", o.x),
    y: pick("y", o.y),
    scale: pick("scale", 1),
    rotation: pick("rotation", o.rotation),
    opacity: Math.max(0, Math.min(1, pick("opacity", o.opacity))),
    blur: Math.max(0, pick("blur", 0)),
  };
}

/** The value a property has without keyframes (what a first key records). */
export function baseValue(o: Overlay, p: AnimProp): number {
  switch (p) {
    case "x":
      return o.x;
    case "y":
      return o.y;
    case "rotation":
      return o.rotation;
    case "opacity":
      return o.opacity;
    case "scale":
      return 1;
    case "blur":
      return 0;
  }
}

/** Adds or replaces the key at `t` (same time within 1/120 s). */
export function setKey(
  keys: Keyframe[] | undefined,
  t: number,
  value: number,
  ease: Ease = "in-out",
): Keyframe[] {
  const rest = (keys ?? []).filter((k) => Math.abs(k.t - t) > 1 / 120);
  const old = (keys ?? []).find((k) => Math.abs(k.t - t) <= 1 / 120);
  return sorted([...rest, { t, value, ease: old?.ease ?? ease }]);
}

/** Times of every key of an overlay (for diamonds on the timeline). */
export function keyTimes(o: Overlay): number[] {
  const times = new Set<number>();
  for (const keys of Object.values(o.keyframes ?? {}))
    for (const k of keys ?? []) times.add(Math.round(k.t * 1000) / 1000);
  return [...times].sort((a, b) => a - b);
}

// Text animators

export type TextUnit = { text: string; line: number; index: number };

/** Splits text into the animator's units (spaces are never units). */
export function unitsOf(
  lines: string[],
  unit: TextAnimator["unit"],
): TextUnit[] {
  const out: TextUnit[] = [];
  lines.forEach((line, row) => {
    if (unit === "line") {
      if (line.trim()) out.push({ text: line, line: row, index: out.length });
      return;
    }
    const parts =
      unit === "word" ? line.split(" ").filter(Boolean) : Array.from(line);
    for (const text of parts)
      if (text.trim()) out.push({ text, line: row, index: out.length });
  });
  return out;
}

/** Deterministic shuffle: same text, same "random" order on every frame. */
function shuffled(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let seed = count * 9301 + 49297;
  for (let i = count - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** When each unit starts, in multiples of `stagger`. */
export function unitRanks(
  count: number,
  order: TextAnimator["order"],
): number[] {
  if (order === "reverse")
    return Array.from({ length: count }, (_, i) => count - 1 - i);
  if (order === "center") {
    const mid = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) =>
      Math.round(Math.abs(i - mid)),
    );
  }
  if (order === "random") {
    const ranks = new Array<number>(count);
    shuffled(count).forEach((unit, rank) => {
      ranks[unit] = rank;
    });
    return ranks;
  }
  return Array.from({ length: count }, (_, i) => i);
}

/** Seconds until every unit has settled. */
export function animatorLength(a: TextAnimator, count: number): number {
  const last = Math.max(0, ...unitRanks(count, a.order));
  return last * a.stagger + a.duration;
}

export const REST: UnitState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
  blur: 0,
};

const mix = (from: UnitState, k: number): UnitState => ({
  opacity: from.opacity + (1 - from.opacity) * k,
  dx: from.dx * (1 - k),
  dy: from.dy * (1 - k),
  scale: from.scale + (1 - from.scale) * k,
  rotation: from.rotation * (1 - k),
  blur: from.blur * (1 - k),
});

/**
 * Every unit's state at `local` seconds into an overlay of `duration`. With
 * `exit`, the units leave in the same order before the end.
 */
export function animatorAt(
  a: TextAnimator,
  count: number,
  local: number,
  duration: number,
): UnitState[] {
  const ranks = unitRanks(count, a.order);
  const length = animatorLength(a, count);
  const outStart = a.exit ? Math.max(length, duration - length) : Infinity;
  return ranks.map((rank) => {
    const begin = rank * a.stagger;
    const into = a.duration > 0 ? (local - begin) / a.duration : 1;
    let k = into <= 0 ? 0 : into >= 1 ? 1 : eased(a.ease, into);
    if (local >= outStart) {
      const away = a.duration > 0 ? (local - outStart - begin) / a.duration : 1;
      if (away > 0) k = away >= 1 ? 0 : 1 - eased(a.ease, away);
    }
    // Opacity never overshoots, the motion may (back, spring).
    const state = mix(a.from, k);
    return { ...state, opacity: Math.max(0, Math.min(1, state.opacity)) };
  });
}
