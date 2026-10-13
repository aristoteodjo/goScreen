import { z } from "zod";

// A motion spec describes a video the way a motion designer would build it:
// shots on a timeline, each with its own layers. It is what the analysis of a
// reference video produces, what an AI edits, and what goScreen renders back
// (`html.ts`). Positions are fractions of the frame, sizes fractions of its
// height, and every time is in seconds from the start of the video.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb");
const fraction = z.number().min(-1).max(2);
const time = z.number().min(0);

/** A cubic Bézier, as in CSS `cubic-bezier(x1, y1, x2, y2)`. */
export const Bezier = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const Word = z.object({
  text: z.string().min(1),
  /** When it starts to come in. */
  at: time,
  /** Drawn in the accent colour. */
  accent: z.boolean().default(false),
  /** When a line is drawn through it, if ever. */
  strike: time.optional(),
  /** Faded copies stacked above it, like an echo. */
  echo: z.boolean().default(false),
  /** A counter: counts from `from` (at `start`) up to its text (at `end`). */
  count: z.object({ from: z.number(), start: time, end: time }).optional(),
  /** Its own ink, when it is neither the shot's nor the accent (a dark tagline under a white URL). */
  color: hex.optional(),
  /** Measured left edge and width of its letters: the renderer fits it there. */
  x: fraction.optional(),
  w: z.number().positive().max(2).optional(),
});

export const Line = z.object({
  words: z.array(Word).min(1),
  /** Its own font size, when it is not the shot's (a tagline under a title). */
  size: z.number().positive().max(1).optional(),
  /** Its measured baseline: each line sits where it was, whatever its size. */
  y: fraction.optional(),
});

/** How each word comes in: from below, blurred, faded. */
export const Enter = z.object({
  /** Vertical offset at the start, in font sizes (positive = from below). */
  y: z.number().default(0.35),
  /** Blur at the start, in font sizes. */
  blur: z.number().min(0).default(0.12),
  duration: z.number().positive().default(0.35),
  ease: Bezier.default([0.22, 1, 0.36, 1]),
});

export const Underline = z.object({
  /** Starts drawing at this time, then follows the words as they come. */
  at: time,
  /** Its left edge, when it does not start with the text (under a bullet). */
  x: fraction.optional(),
  /** Gap below the last baseline, in font sizes. */
  offset: z.number().default(0.32),
  /** Thickness, in font sizes. */
  thickness: z.number().positive().default(0.04),
  /** How far it runs past the last word, in font sizes. */
  overshoot: z.number().default(0.1),
});

export const Kicker = z.object({
  text: z.string().min(1),
  at: time,
  /** Gap above the first line's cap height, in font sizes. */
  gap: z.number().default(0.35),
});

/** A picture file next to the spec, named without any folder. */
const fileName = z
  .string()
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|jpe?g|webp|webm|mp4)$/, "Expected a file name");

/** Where a visual is at a moment: its centre (fractions) and its scale. */
export const VisualPoint = z.object({
  t: time,
  x: fraction,
  y: fraction,
  scale: z.number().positive().max(20),
});

/**
 * A patch drawn over a picture, in the colour around it, while a word that
 * the renderer draws as text is in it: the text is never seen twice.
 */
export const Cover = z.object({
  x: fraction,
  y: fraction,
  w: z.number().positive().max(3),
  h: z.number().positive().max(3),
  color: hex,
  at: time,
  until: time,
});

/**
 * A picture placed in a shot: a still image moved along a path, or a clip
 * (a part of the reference that animates inside, like an interface) played
 * from `at`. Its file lives next to the spec, named without any folder.
 */
export const Visual = z.object({
  kind: z.enum(["image", "clip"]).default("image"),
  src: fileName,
  /** Left, top, width and height of the picture at rest. */
  x: fraction,
  y: fraction,
  w: z.number().positive().max(3),
  h: z.number().positive().max(3),
  /** Comes in (a clip's first frame is shown at this time). */
  at: time,
  /** Fade in, in seconds (0 = appears at once, or moves in along its path). */
  fadeIn: z.number().min(0).default(0),
  /** Leaves. */
  until: time,
  fadeOut: z.number().min(0).default(0),
  /** Measured moves; empty = it stays at rest. */
  path: z.array(VisualPoint).default([]),
  /** Where its words are hidden (frame fractions, they follow its moves). */
  covers: z.array(Cover).default([]),
});

/**
 * A word as it reads in a shot that is not kinetic text (a slide, a page):
 * measured place, size, colour and timing, drawn as text over the pictures.
 */
export const Label = z.object({
  text: z.string().min(1),
  /** Left edge and baseline. */
  x: fraction,
  y: fraction,
  /** Font size. */
  size: z.number().positive().max(1),
  /** Measured width of its letters: the renderer fits it there. */
  w: z.number().positive().max(2).optional(),
  color: hex,
  weight: z.number().int().min(100).max(900).default(600),
  at: time,
  fadeIn: z.number().min(0).default(0),
  until: time,
  /**
   * A counter: the number counts from `from` (at `start`) up to its text (at
   * `end`), whole numbers, easing out.
   */
  count: z.object({ from: z.number(), start: time, end: time }).optional(),
  /** Measured moves of its letters (centre and scale from rest); empty = it stays. */
  path: z.array(VisualPoint).default([]),
});

export const TextShot = z.object({
  kind: z.literal("text"),
  id: z.string().min(1),
  start: time,
  end: time,
  background: hex,
  /** The background as it is (gradient, texture, shadows), over `background`. */
  plate: fileName.optional(),
  ink: hex,
  accent: hex,
  /** Left edge of the text. */
  x: fraction,
  /** Baseline of the last line: lines stack upwards from it. */
  y: fraction,
  /** Font size. */
  size: z.number().positive().max(1),
  weight: z.number().int().min(100).max(900).default(600),
  lineHeight: z.number().positive().default(1.1),
  kicker: Kicker.optional(),
  lines: z.array(Line).min(1),
  underline: Underline.optional(),
  enter: Enter.default({
    y: 0.35,
    blur: 0.12,
    duration: 0.35,
    ease: [0.22, 1, 0.36, 1],
  }),
  /** How it leaves at `end`: a cut, or a quick blur upwards. */
  exit: z.enum(["cut", "blur"]).default("cut"),
  /** Pictures around the text (bullets, a logo), drawn behind it. */
  visuals: z.array(Visual).default([]),
});

/**
 * A shot goScreen does not rebuild as text (a logo, an interface): its
 * pictures are taken from the reference (`visuals`), at their measured place
 * and timing; without any, it keeps its place and length in the film.
 */
export const PlaceholderShot = z.object({
  kind: z.literal("placeholder"),
  id: z.string().min(1),
  start: time,
  end: time,
  background: hex,
  plate: fileName.optional(),
  /** What the shot shows, as the analysis understood it. */
  label: z.string().default(""),
  /** What it shows, cut out of the reference (an interface, a logo). */
  visuals: z.array(Visual).default([]),
  /** Its big words, which the pictures leave out. */
  labels: z.array(Label).default([]),
});

export const Shot = z.discriminatedUnion("kind", [TextShot, PlaceholderShot]);

export const Fonts = z.object({
  /** CSS font stack of the text. */
  text: z
    .string()
    .default(
      "'Inter Display', 'Inter', 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif",
    ),
  /** CSS font stack of small labels (kickers). */
  mono: z
    .string()
    .default("'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"),
});

export const MotionSpec = z
  .object({
    version: z.literal(1),
    width: z.number().int().positive().max(7680),
    height: z.number().int().positive().max(4320),
    fps: z.number().positive().max(120),
    duration: z.number().positive(),
    fonts: Fonts.default({
      text: Fonts.shape.text.parse(undefined),
      mono: Fonts.shape.mono.parse(undefined),
    }),
    shots: z.array(Shot),
  })
  .superRefine((spec, ctx) => {
    spec.shots.forEach((s, i) => {
      s.visuals.forEach((v, k) => {
        if (v.until <= v.at)
          ctx.addIssue({
            code: "custom",
            path: ["shots", i, "visuals", k, "until"],
            message: "A visual must leave after it comes in.",
          });
      });
      if (s.end <= s.start)
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "end"],
          message: "A shot must end after it starts.",
        });
    });
  });

export type Word = z.infer<typeof Word>;
export type Line = z.infer<typeof Line>;
export type Enter = z.infer<typeof Enter>;
export type Underline = z.infer<typeof Underline>;
export type Label = z.infer<typeof Label>;
export type VisualPoint = z.infer<typeof VisualPoint>;
export type Cover = z.infer<typeof Cover>;
export type Visual = z.infer<typeof Visual>;
export type TextShot = z.infer<typeof TextShot>;
export type PlaceholderShot = z.infer<typeof PlaceholderShot>;
export type Shot = z.infer<typeof Shot>;
export type MotionSpec = z.infer<typeof MotionSpec>;
export type MotionSpecInput = z.input<typeof MotionSpec>;

/** Parses a spec; the message names the first wrong field (`shots.2.end: …`). */
export function parseMotionSpec(
  value: unknown,
): { ok: true; spec: MotionSpec } | { ok: false; error: string } {
  const r = MotionSpec.safeParse(value);
  if (r.success) return { ok: true, spec: r.data };
  const issue = r.error.issues[0];
  return {
    ok: false,
    error: `${issue.path.join(".") || "spec"}: ${issue.message}`,
  };
}
