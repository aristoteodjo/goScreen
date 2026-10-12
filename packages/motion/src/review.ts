import { z } from "zod";
import type { Line, Shot, TextShot, Word } from "./schema.ts";

// An AI looks at a frame of each shot and corrects what measurements cannot
// know: the exact text (OCR misses accents, apostrophes, short words), which
// words are accented or struck, what a shot that is not text shows. Timing and
// layout stay measured: the AI never invents them. Same contract for every
// model (local Qwen3-VL in the app, Claude through MCP).

export const ShotReview = z.object({
  kind: z.enum(["text", "logo", "interface", "other"]),
  /** Text shots: every line, every word, in reading order. */
  lines: z
    .array(
      z.array(
        z.object({
          text: z.string().min(1),
          accent: z.boolean().default(false),
          strike: z.boolean().default(false),
        }),
      ),
    )
    .default([]),
  kicker: z.string().nullable().default(null),
  /** What the shot shows, in a few words (for shots goScreen cannot rebuild). */
  description: z.string().default(""),
});
export type ShotReview = z.infer<typeof ShotReview>;

/** The JSON schema the model must answer with (llama.cpp turns it into a grammar). */
export const SHOT_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["text", "logo", "interface", "other"] },
    lines: {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            accent: { type: "boolean" },
            strike: { type: "boolean" },
          },
          required: ["text", "accent", "strike"],
        },
      },
    },
    kicker: { type: ["string", "null"] },
    description: { type: "string" },
  },
  required: ["kind", "lines", "kicker", "description"],
} as const;

/** When a shot is best seen: all its words in, just before it leaves. */
export function shotKeyTime(shot: Shot): number {
  if (shot.kind !== "text") return (shot.start + shot.end) / 2;
  const words = shot.lines.flatMap((l) => l.words);
  const last = Math.max(...words.map((w) => w.at)) + shot.enter.duration + 0.25;
  return Math.min(Math.max(last, shot.start), shot.end - 0.1);
}

export const REVIEW_SYSTEM = `You check the analysis of a motion-design video, one shot at a time.
You receive a frame of the shot and what the measurements found. Answer in JSON only.
- kind: "text" if the frame is mostly animated words on a plain background; "logo" for a brand mark;
  "interface" for an app screen or web page; "other" otherwise.
- lines: the large text exactly as written in the frame, line by line, word by word, with its
  accents, apostrophes and punctuation (keep punctuation attached to its word). accent = the word is
  in a different colour from the others. strike = a line is drawn through the word.
- kicker: the small label above the text, if any, else null.
- description: what the shot shows, in at most 8 words.
Never invent words that are not in the frame.`;

/** The question about one shot. */
export function reviewPrompt(shot: Shot): string {
  if (shot.kind !== "text")
    return "The measurements found no large text in this shot. What does it show?";
  const found = shot.lines
    .map((l) =>
      l.words
        .map((w) => `${w.text}${w.accent ? " (accent)" : ""}${w.strike !== undefined ? " (struck)" : ""}`)
        .join(" "),
    )
    .join(" / ");
  return `The measurements read: ${found}${shot.kicker ? `; small label above: ${shot.kicker.text}` : ""}. Correct it from the frame.`;
}

/** Spreads `n` word times over the measured ones (when the AI split or merged words). */
export function spreadTimes(times: number[], n: number): number[] {
  if (!times.length) return Array.from({ length: n }, () => 0);
  if (times.length === n) return times;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (n === 1) return [first];
  return Array.from({ length: n }, (_, i) => first + ((last - first) * i) / (n - 1));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The shot with the AI's corrections: its words and styles, on the measured
 * timing and layout. A shot the AI sees as a logo or an interface becomes a
 * placeholder that names it.
 */
export function applyReview(shot: Shot, review: ShotReview): Shot {
  if (review.kind !== "text" || !review.lines.length) {
    if (shot.kind === "text" && review.kind === "text") return shot;
    return {
      kind: "placeholder",
      id: shot.id,
      start: shot.start,
      end: shot.end,
      background: shot.background,
      label: review.description || review.kind,
    };
  }
  if (shot.kind !== "text")
    return { ...shot, label: review.description || shot.label };
  const measured = shot.lines.flatMap((l) => l.words);
  const times = spreadTimes(
    measured.map((w) => w.at),
    review.lines.flat().length,
  );
  const strikeAfter = (at: number) =>
    measured.find((w) => w.strike !== undefined)?.strike ?? round(at + 0.6);
  let k = 0;
  const lines: Line[] = review.lines.map((row) => ({
    words: row.map((w): Word => {
      const at = round(times[k++]);
      return {
        text: w.text,
        at,
        accent: w.accent,
        echo: measured.find((m) => m.text === w.text)?.echo ?? false,
        ...(w.strike ? { strike: strikeAfter(at) } : {}),
      };
    }),
  }));
  const next: TextShot = { ...shot, lines };
  if (review.kicker)
    next.kicker = { text: review.kicker, at: shot.kicker?.at ?? shot.start, gap: shot.kicker?.gap ?? 0.35 };
  else delete next.kicker;
  return next;
}
