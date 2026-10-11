// One-click animations: each preset writes plain keyframes or a text
// animator, so the result stays editable key by key afterwards.

import type {
  Ease,
  Keyframe,
  Overlay,
  PropertyTracks,
  TextAnimator,
} from "./types";

export type AnimationPreset = {
  id: string;
  label: string;
  group: "text" | "motion";
  description: string;
  apply: (o: Overlay) => Overlay;
};

const k = (t: number, value: number, ease: Ease = "in-out"): Keyframe => ({
  t,
  value,
  ease,
});

function text(
  id: string,
  label: string,
  description: string,
  animator: TextAnimator,
): AnimationPreset {
  return {
    id,
    label,
    group: "text",
    description,
    apply: (o) =>
      o.kind === "text"
        ? // The animator replaces the simple enter/exit reveals.
          { ...o, animator, enter: "none", exit: "fade" }
        : o,
  };
}

const still = { opacity: 0, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0 };

function motion(
  id: string,
  label: string,
  description: string,
  tracks: (o: Overlay) => PropertyTracks,
): AnimationPreset {
  return {
    id,
    label,
    group: "motion",
    description,
    apply: (o) => ({
      ...o,
      enter: "none",
      exit: "none",
      keyframes: { ...o.keyframes, ...tracks(o) },
    }),
  };
}

export const ANIMATION_PRESETS: AnimationPreset[] = [
  text("words-up", "Words rise", "Each word fades in from below.", {
    unit: "word",
    order: "forward",
    stagger: 0.07,
    duration: 0.5,
    ease: "out",
    from: { ...still, dy: 0.45 },
    exit: false,
  }),
  text("letters-pop", "Letters pop", "Letters spring in from small.", {
    unit: "char",
    order: "forward",
    stagger: 0.03,
    duration: 0.45,
    ease: "back",
    from: { ...still, scale: 0.2 },
    exit: false,
  }),
  text("typewriter", "Typewriter", "Letters appear one by one.", {
    unit: "char",
    order: "forward",
    stagger: 0.045,
    duration: 0.01,
    ease: "hold",
    from: still,
    exit: false,
  }),
  text("blur-in", "Blur in", "Words come into focus.", {
    unit: "word",
    order: "forward",
    stagger: 0.08,
    duration: 0.6,
    ease: "out",
    from: { ...still, blur: 0.02, scale: 1.08 },
    exit: false,
  }),
  text("lines-slide", "Lines slide", "Each line slides in from the left.", {
    unit: "line",
    order: "forward",
    stagger: 0.14,
    duration: 0.6,
    ease: "out",
    from: { ...still, dx: -0.8 },
    exit: true,
  }),
  text("words-spring", "Words spring", "Words bounce up into place.", {
    unit: "word",
    order: "forward",
    stagger: 0.08,
    duration: 0.8,
    ease: "spring",
    from: { ...still, dy: 0.9, scale: 0.85 },
    exit: false,
  }),
  text("center-out", "From the centre", "Letters open out from the middle.", {
    unit: "char",
    order: "center",
    stagger: 0.035,
    duration: 0.4,
    ease: "out",
    from: { ...still, scale: 1.8 },
    exit: false,
  }),
  text("flicker", "Flicker", "Letters switch on in a random order.", {
    unit: "char",
    order: "random",
    stagger: 0.025,
    duration: 0.12,
    ease: "linear",
    from: still,
    exit: true,
  }),
  motion(
    "drop-in",
    "Drop in",
    "Falls into place with a small bounce.",
    (o) => ({
      y: [k(0, o.y - 0.12, "back"), k(0.6, o.y)],
      opacity: [k(0, 0, "out"), k(0.3, o.opacity)],
    }),
  ),
  motion("zoom-in", "Zoom in", "Grows from nothing.", (o) => ({
    scale: [k(0, 0.2, "back"), k(0.5, 1)],
    opacity: [k(0, 0, "out"), k(0.25, o.opacity)],
  })),
  motion("spin-in", "Spin in", "Turns into place.", (o) => ({
    rotation: [k(0, o.rotation - 90, "out"), k(0.6, o.rotation)],
    scale: [k(0, 0.6, "out"), k(0.6, 1)],
    opacity: [k(0, 0, "out"), k(0.3, o.opacity)],
  })),
  motion(
    "slow-zoom",
    "Slow zoom",
    "Ken Burns: a slow push in over the whole life.",
    (o) => ({
      scale: [k(0, 1, "linear"), k(o.duration, 1.12)],
    }),
  ),
  motion(
    "pulse",
    "Pulse",
    "Beats once in the middle, to draw the eye.",
    (o) => {
      const mid = o.duration / 2;
      return {
        scale: [k(0, 1), k(mid - 0.2, 1), k(mid, 1.12), k(mid + 0.25, 1)],
      };
    },
  ),
  motion("float", "Float", "Bobs gently up and down.", (o) => {
    const keys: Keyframe[] = [];
    for (let t = 0, up = true; t <= o.duration; t += 1, up = !up)
      keys.push(k(t, o.y + (up ? -0.008 : 0.008)));
    return { y: keys };
  }),
  motion("shake", "Shake", "A short shake to point at something.", () => ({
    rotation: [
      k(0, 0),
      k(0.08, -6),
      k(0.16, 6),
      k(0.24, -4),
      k(0.32, 3),
      k(0.4, 0),
    ],
  })),
  motion("blur-reveal", "Blur reveal", "Comes out of a blur.", (o) => ({
    blur: [k(0, 0.03, "out"), k(0.6, 0)],
    opacity: [k(0, 0, "out"), k(0.4, o.opacity)],
  })),
];

export function applyPreset(o: Overlay, id: string): Overlay {
  const preset = ANIMATION_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown animation preset "${id}".`);
  return preset.apply(o);
}

/** Removes every keyframe and text animator: back to the simple motions. */
export function clearAnimation(o: Overlay): Overlay {
  const { keyframes: _k, ...rest } = o;
  return rest.kind === "text"
    ? { ...rest, animator: null, enter: "fade", exit: "fade" }
    : { ...rest, enter: "fade", exit: "fade" };
}
