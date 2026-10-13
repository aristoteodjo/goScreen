import { z } from "zod";

// What the analyser (scenario-runner/analyze.mjs) measured in a video: facts
// only, in pixels of the source and seconds. `derive.ts` interprets them.

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const ObservedWord = z.object({
  text: z.string(),
  conf: z.number(),
  /** How many OCR samples read it. */
  seen: z.number().int(),
  box: Box,
  color: z.string().nullable(),
  /** Comes in, settles, leaves (seconds). */
  start: z.number(),
  settled: z.number(),
  end: z.number(),
  /** Left out of the pictures the analyser cut: the renderer must draw it. */
  masked: z.boolean().default(false),
  /** The lettering of a logo (letters spread apart): part of a picture, not text. */
  mark: z.boolean().default(false),
  /** The colour just around it once settled: what hides it in a picture. */
  around: z.string().nullable().default(null),
});

export const ObservedRule = Box.extend({ t: z.number(), color: z.string() });

/**
 * Something on screen that is not a word nor the background (a logo, an
 * interface, a bullet), followed from sample to sample. `image` is the file
 * the analyser cut out of the video: a still picture, or a clip of its area
 * from `start` to `end` when it animates inside (`kind: "clip"`).
 */
export const ObservedVisual = z.object({
  kind: z.enum(["image", "clip"]).default("image"),
  image: z.string().nullable(),
  /** Where the file was cut: the picture at rest, or every place a clip goes. */
  box: Box,
  start: z.number(),
  settled: z.number(),
  end: z.number(),
  /** How much it changes inside, 0..255 (thumbnail difference). */
  changes: z.number().default(0),
  /** Its box at each sample. */
  path: z.array(Box.extend({ t: z.number() })).default([]),
});

export const Observations = z.object({
  version: z.literal(1),
  source: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().positive(),
  cuts: z.array(z.number()),
  backgrounds: z.array(z.object({ t: z.number(), color: z.string() })),
  rules: z.array(ObservedRule),
  words: z.array(ObservedWord),
  /** Older measurements have none. */
  visuals: z.array(ObservedVisual).default([]),
  /**
   * The background of each cut with nothing on it (gradient, texture, fixed
   * shadows), cut out as an image; `seen` = share of its pixels ever free.
   */
  plates: z
    .array(z.object({ start: z.number(), end: z.number(), image: z.string(), seen: z.number().default(1) }))
    .default([]),
});

export type Box = z.infer<typeof Box>;
export type ObservedWord = z.infer<typeof ObservedWord>;
export type ObservedRule = z.infer<typeof ObservedRule>;
export type ObservedVisual = z.infer<typeof ObservedVisual>;
export type Observations = z.infer<typeof Observations>;
