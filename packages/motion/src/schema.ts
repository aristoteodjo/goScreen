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
});

export const Line = z.object({ words: z.array(Word).min(1) });

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

export const TextShot = z.object({
  kind: z.literal("text"),
  id: z.string().min(1),
  start: time,
  end: time,
  background: hex,
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
});

/**
 * A shot goScreen cannot rebuild yet (a logo, an interface): it keeps its
 * place and length in the film, so the timing of everything else is right.
 */
export const PlaceholderShot = z.object({
  kind: z.literal("placeholder"),
  id: z.string().min(1),
  start: time,
  end: time,
  background: hex,
  /** What the shot shows, as the analysis understood it. */
  label: z.string().default(""),
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
