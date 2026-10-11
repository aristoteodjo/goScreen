import { easeInOut } from "./camera";
import { spring, springSettle } from "./keyframes";
import type { Animation, Overlay } from "./types";

// How an animated element looks at one instant. Offsets are fractions of
// the output size; `reveal` drives typewriter, words and wipe (0..1).
export type Motion = {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  reveal: number;
};

export const STILL: Motion = { opacity: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };

// The spring is fitted to the motion span: settled by its end.
const SPRING_SPAN = springSettle();

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** One animation at progress p (0 = hidden, 1 = in place). */
export function animate(kind: Animation, p: number): Motion {
  const e = easeInOut(clamp01(p));
  switch (kind) {
    case "none":
      return STILL;
    case "fade":
      return { ...STILL, opacity: e };
    case "slide-up":
      return { ...STILL, opacity: e, dy: (1 - e) * 0.06 };
    case "slide-left":
      return { ...STILL, opacity: e, dx: (1 - e) * 0.08 };
    case "pop": {
      // Overshoots a little before settling, like a spring.
      const q = clamp01(p);
      const s = q < 0.7 ? 0.6 + (q / 0.7) * 0.5 : 1.1 - ((q - 0.7) / 0.3) * 0.1;
      return { ...STILL, opacity: clamp01(q * 2.5), scale: s };
    }
    case "spring": {
      // Rises into place with a physical overshoot (Remotion's default spring).
      const s = spring(clamp01(p) * SPRING_SPAN);
      return {
        ...STILL,
        opacity: clamp01(p * 3),
        dy: (1 - s) * 0.05,
        scale: 0.92 + 0.08 * s,
      };
    }
    case "typewriter":
    case "words":
    case "wipe":
      return { ...STILL, reveal: kind === "wipe" ? e : clamp01(p) };
  }
}

/** An element with enter and exit motions, at `local` seconds into its life. */
export function motionAt(
  enter: Animation,
  exit: Animation,
  motion: number,
  duration: number,
  local: number,
): Motion {
  if (local < 0 || local > duration) return { ...STILL, opacity: 0 };
  // Short elements share their time between enter and exit.
  const span = Math.min(motion, duration / 2);
  if (span <= 0) return STILL;
  if (local < span) return animate(enter, local / span);
  if (local > duration - span) {
    const out = animate(exit, (duration - local) / span);
    // Text reveals read better un-revealed by fading out.
    return exit === "typewriter" || exit === "words"
      ? { ...out, reveal: 1, opacity: clamp01((duration - local) / span) }
      : out;
  }
  return STILL;
}

export function overlayMotion(o: Overlay, t: number): Motion {
  return motionAt(o.enter, o.exit, o.motion, o.duration, t - o.start);
}

/** Overlays showing at timeline time t, bottom lane first. */
export function activeOverlays(overlays: Overlay[], t: number): Overlay[] {
  return overlays
    .filter((o) => t >= o.start && t <= o.start + o.duration)
    .sort((a, b) => a.lane - b.lane);
}

/** Characters shown by a typewriter at `reveal`. */
export function typedText(text: string, reveal: number): string {
  const chars = Array.from(text);
  return chars.slice(0, Math.round(chars.length * clamp01(reveal))).join("");
}

/** Opacity of each word of a word-by-word reveal; each word fades over a short stagger. */
export function wordOpacities(words: number, reveal: number): number[] {
  if (words <= 0) return [];
  // Each word fades over `fade`; starts are spread so the last ends at 1.
  const fade = Math.min(1, 1.6 / words);
  const gap = words > 1 ? (1 - fade) / (words - 1) : 0;
  return Array.from({ length: words }, (_, i) =>
    clamp01((reveal - i * gap) / fade),
  );
}

/** Slides reveal the title first, then the subtitle a beat later. */
export function slideMotion(
  animation: Animation,
  duration: number,
  local: number,
): { title: Motion; subtitle: Motion } {
  const motion = Math.min(0.8, duration / 3);
  const delay = Math.min(0.35, duration / 6);
  return {
    title: motionAt(animation, "fade", motion, duration, local),
    subtitle: motionAt(
      animation,
      "fade",
      motion,
      Math.max(0.01, duration - delay),
      local - delay,
    ),
  };
}
