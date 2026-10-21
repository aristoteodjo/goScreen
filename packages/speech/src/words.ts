import { z } from "zod";

// The words of a take: what a speech-to-text engine heard, in source seconds.
// This file (`<stem>.words.json`) is the contract every speech tool reads.

export const wordSchema = z.object({
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  // Confidence, 0..1.
  p: z.number().min(0).max(1),
});

export const wordsFileSchema = z.object({
  language: z.string(),
  source: z.enum(["whisper", "manual"]),
  words: z.array(wordSchema),
});

export type Word = z.infer<typeof wordSchema>;
export type WordsFile = z.infer<typeof wordsFileSchema>;

/** Parses a words file; words out of order or ending before they start are dropped. */
export function parseWords(raw: unknown): WordsFile | null {
  const parsed = wordsFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const words = parsed.data.words
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  return { ...parsed.data, words };
}

/** Loudness over time: one RMS value every `dt` seconds, from time 0. */
export type Envelope = { dt: number; rms: number[] };

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * Attacks of energy: the times where the envelope rises through a threshold
 * set between the noise floor (10th percentile) and the loud part (95th).
 */
export function onsetsOf(envelope: Envelope, ratio = 0.25): number[] {
  const { dt, rms } = envelope;
  if (rms.length < 2 || dt <= 0) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = quantile(sorted, 0.1);
  const loud = quantile(sorted, 0.95);
  if (loud <= floor) return [];
  const threshold = floor + ratio * (loud - floor);
  const out: number[] = [];
  for (let i = 1; i < rms.length; i++)
    if (rms[i] >= threshold && rms[i - 1] < threshold) out.push(i * dt);
  return out;
}

export type SnapOptions = { maxShift?: number };

/**
 * Moves each word's start to the nearest attack of energy (STT timestamps
 * run up to a third of a second early). A start never moves more than
 * `maxShift`, never past the word's end, never before the previous word's end.
 */
export function snapToOnset(
  words: Word[],
  envelope: Envelope,
  { maxShift = 0.35 }: SnapOptions = {},
): Word[] {
  const onsets = onsetsOf(envelope);
  const out: Word[] = [];
  let previousEnd = 0;
  for (const word of words) {
    const latest = word.end - Math.min(0.02, (word.end - word.start) / 2);
    let best: number | null = null;
    for (const t of onsets) {
      if (t < word.start - maxShift) continue;
      if (t > word.start + maxShift) break;
      if (t < previousEnd || t > latest) continue;
      if (
        best === null ||
        Math.abs(t - word.start) < Math.abs(best - word.start)
      )
        best = t;
    }
    const start = Math.min(latest, Math.max(previousEnd, best ?? word.start));
    const snapped = { ...word, start };
    out.push(snapped);
    previousEnd = snapped.end;
  }
  return out;
}

/** Lower-case, no accents, no punctuation: how words are compared. */
export function normalizeWord(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      // An apostrophe or a hyphen inside a word joins it ("essayez-le",
      // "aujourd'hui"): speech-to-text gives such a word in one piece.
      .replace(/(?<=\p{L})['’-](?=\p{L})/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/** The normalized tokens of a text (a script line, a word of a take). */
export function tokensOf(text: string): string[] {
  return normalizeWord(text).split(/\s+/).filter(Boolean);
}
