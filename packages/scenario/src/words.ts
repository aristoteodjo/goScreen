// The words of a take, as a transcription writes them next to the recording
// (`<stem>.words.json`): what captions, subtitles and the music's ending are
// cut from. Times are seconds of the take's source (the recording), never of
// the timeline: clips move, words follow them.

import { z } from "zod";

export const wordSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
    // Confidence, 0..1.
    p: z.number().min(0).max(1).catch(1),
  })
  .refine((w) => w.end >= w.start, { message: "end before start" });

export const wordsFileSchema = z.object({
  language: z.string().min(1),
  source: z.enum(["whisper", "manual"]),
  words: z.array(wordSchema),
});

export type Word = z.infer<typeof wordSchema>;
export type WordsFile = z.infer<typeof wordsFileSchema>;

/** Sidecar name of a recording's words: `rec.mp4` -> `rec.words.json`. */
export function wordsFileOf(videoPath: string): string {
  return `${videoPath.replace(/\.[^./\\]+$/, "")}.words.json`;
}

/**
 * Reads a words file item by item: a word out of shape is left out alone,
 * the rest is kept in time order. Null when the file is not a words file.
 */
export function parseWordsFile(json: unknown): WordsFile | null {
  const shell = z
    .object({
      language: z.string().min(1).catch("und"),
      source: z.enum(["whisper", "manual"]).catch("manual"),
      words: z.array(z.unknown()),
    })
    .safeParse(json);
  if (!shell.success) return null;
  const words = shell.data.words
    .flatMap((raw) => {
      const r = wordSchema.safeParse(raw);
      return r.success ? [r.data] : [];
    })
    .sort((a, b) => a.start - b.start);
  return { language: shell.data.language, source: shell.data.source, words };
}

/** The words spoken between two source times, in order. */
export function wordsBetween(words: Word[], from: number, to: number): Word[] {
  return words.filter((w) => w.start >= from && w.start < to);
}
