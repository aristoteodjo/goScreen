import { easeInOut } from "./camera";
import { sharp, sharpOut } from "./look";
import { clipDuration, type Placed, placeClips } from "./sequence";
import type { MainClip, Transition, TransitionKind } from "./types";

export const TRANSITION_KINDS: { id: TransitionKind; label: string }[] = [
  { id: "fade", label: "Cross fade" },
  { id: "dip", label: "Dip to black" },
  { id: "slide-left", label: "Push left" },
  { id: "slide-up", label: "Push up" },
  { id: "zoom", label: "Zoom through" },
  { id: "wipe", label: "Wipe" },
  { id: "blur", label: "Cut blur" },
  { id: "push", label: "Push in" },
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
  // Blur over both sides, as a fraction of the output's short side.
  blur: number;
  // Sub-frames to accumulate for motion blur (1 = none).
  samples: number;
};

const SIDE = { alpha: 1, dx: 0, dy: 0, scale: 1 };

export function transitionMix(
  kind: TransitionKind,
  progress: number,
): TransitionMix {
  const raw = Math.max(0, Math.min(1, progress));
  const p = easeInOut(raw);
  const base: TransitionMix = {
    from: { ...SIDE },
    to: { ...SIDE },
    dip: 0,
    reveal: 1,
    fromOnTop: true,
    blur: 0,
    samples: 1,
  };
  switch (kind) {
    case "blur": {
      // Soft at the cut (30 px at 1080p), sharp a few frames either side.
      const peak = 1 - Math.abs(raw * 2 - 1) ** 1.5;
      return {
        ...base,
        from: { ...SIDE, alpha: 1 - p },
        blur: (30 / 1080) * peak,
        samples: 1,
      };
    }
    case "push": {
      // The outgoing side accelerates in; the incoming lands sharp.
      const out = sharpOut(raw);
      const land = sharp(raw);
      return {
        ...base,
        fromOnTop: false,
        from: { ...SIDE, alpha: 1 - out, scale: 1 + 0.12 * out },
        to: { ...SIDE, alpha: Math.min(1, raw * 2), scale: 1.15 - 0.15 * land },
        blur: (12 / 1080) * (1 - Math.abs(raw * 2 - 1)),
        samples: 3,
      };
    }
    case "fade":
      return { ...base, from: { ...SIDE, alpha: 1 - p } };
    case "dip":
      // First half fades out to black, second half fades in from it.
      return p < 0.5
        ? { ...base, from: { ...SIDE }, to: { ...SIDE, alpha: 0 }, dip: p * 2 }
        : { ...base, from: { ...SIDE, alpha: 0 }, dip: (1 - p) * 2 };
    case "slide-left": {
      // Slides come in with the sharp curve and carry motion blur.
      const k = sharp(raw);
      return {
        ...base,
        from: { ...SIDE, dx: -k },
        to: { ...SIDE, dx: 1 - k },
        samples: 3,
      };
    }
    case "slide-up": {
      const k = sharp(raw);
      return {
        ...base,
        from: { ...SIDE, dy: -k },
        to: { ...SIDE, dy: 1 - k },
        samples: 3,
      };
    }
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
