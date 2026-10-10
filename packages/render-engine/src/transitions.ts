import { easeInOut } from "./camera";
import { clipDuration, type Placed, placeClips } from "./sequence";
import type { MainClip, Transition, TransitionKind } from "./types";

export const TRANSITION_KINDS: { id: TransitionKind; label: string }[] = [
  { id: "fade", label: "Cross fade" },
  { id: "dip", label: "Dip to black" },
  { id: "slide-left", label: "Push left" },
  { id: "slide-up", label: "Push up" },
  { id: "zoom", label: "Zoom through" },
  { id: "wipe", label: "Wipe" },
];

export const DEFAULT_TRANSITION: Transition = { kind: "fade", duration: 0.6 };

/** A transition never takes more than half of the clips it joins. */
export function transitionLength(prev: MainClip, next: MainClip): number {
  if (!next.transition) return 0;
  return Math.max(
    0,
    Math.min(
      next.transition.duration,
      clipDuration(prev) / 2,
      clipDuration(next) / 2,
    ),
  );
}

export type ActiveTransition = {
  kind: TransitionKind;
  // 0 at the cut, 1 when the incoming clip is fully in.
  progress: number;
  prev: Placed;
  next: Placed;
};

/** The transition running at timeline time t, if any. */
export function transitionAt(
  clips: MainClip[],
  t: number,
): ActiveTransition | null {
  const placed = placeClips(clips);
  for (let i = 1; i < placed.length; i += 1) {
    const next = placed[i];
    if (t < next.start) return null;
    const length = transitionLength(placed[i - 1].clip, next.clip);
    if (length > 0 && t < next.start + length && next.clip.transition) {
      return {
        kind: next.clip.transition.kind,
        progress: (t - next.start) / length,
        prev: placed[i - 1],
        next,
      };
    }
  }
  return null;
}

// How the two sides are laid out at progress p. Offsets are fractions of
// the output size; alphas are 0..1. `dip` is the black layer between them.
export type TransitionMix = {
  from: { alpha: number; dx: number; dy: number; scale: number };
  to: { alpha: number; dx: number; dy: number; scale: number };
  dip: number;
  // Wipe: fraction of the width (from the left) where the incoming clip shows.
  reveal: number;
  // Which side is drawn on top.
  fromOnTop: boolean;
};

const SIDE = { alpha: 1, dx: 0, dy: 0, scale: 1 };

export function transitionMix(
  kind: TransitionKind,
  progress: number,
): TransitionMix {
  const p = easeInOut(Math.max(0, Math.min(1, progress)));
  const base: TransitionMix = {
    from: { ...SIDE },
    to: { ...SIDE },
    dip: 0,
    reveal: 1,
    fromOnTop: true,
  };
  switch (kind) {
    case "fade":
      return { ...base, from: { ...SIDE, alpha: 1 - p } };
    case "dip":
      // First half fades out to black, second half fades in from it.
      return p < 0.5
        ? { ...base, from: { ...SIDE }, to: { ...SIDE, alpha: 0 }, dip: p * 2 }
        : { ...base, from: { ...SIDE, alpha: 0 }, dip: (1 - p) * 2 };
    case "slide-left":
      return { ...base, from: { ...SIDE, dx: -p }, to: { ...SIDE, dx: 1 - p } };
    case "slide-up":
      return { ...base, from: { ...SIDE, dy: -p }, to: { ...SIDE, dy: 1 - p } };
    case "zoom":
      return {
        ...base,
        from: { ...SIDE, alpha: 1 - p, scale: 1 + 0.35 * p },
        to: { ...SIDE, scale: 0.85 + 0.15 * p },
      };
    case "wipe":
      return { ...base, fromOnTop: false, reveal: p };
  }
}
