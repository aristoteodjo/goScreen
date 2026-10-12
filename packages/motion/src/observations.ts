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
});

export const ObservedRule = Box.extend({ t: z.number(), color: z.string() });

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
});

export type Box = z.infer<typeof Box>;
export type ObservedWord = z.infer<typeof ObservedWord>;
export type ObservedRule = z.infer<typeof ObservedRule>;
export type Observations = z.infer<typeof Observations>;
