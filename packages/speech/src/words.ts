import { type Word, type WordsFile, wordSchema } from "@goscreen/scenario";
import { z } from "zod";

// The words of a take: what a speech-to-text engine heard, in source seconds.
// This file (`<stem>.words.json`) is the contract every speech tool reads.

export { wordSchema, wordsFileSchema } from "@goscreen/scenario";
export type { Word, WordsFile };

/**
 * Parses a words file: the envelope (language, source) must be right; a word
 * out of shape, or ending before it starts, is dropped alone and the rest is
 * kept in time order.
 */
export function parseWords(raw: unknown): WordsFile | null {
  const shell = z
    .object({
      language: z.string(),
      source: z.enum(["whisper", "manual"]),
      words: z.array(z.unknown()),
    })
    .safeParse(raw);
  if (!shell.success) return null;
  const words = shell.data.words
    .map((w) => wordSchema.safeParse(w))
    .flatMap((r) => (r.success && r.data.end > r.data.start ? [r.data] : []))
    .sort((a, b) => a.start - b.start);
  return { language: shell.data.language, source: shell.data.source, words };
}

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
      // An apostrophe or a hyphen splits a word ("essayez-le", "aujourd'hui"):
      // speech-to-text cuts such words one way or the other, so both sides
      // are compared piece by piece.
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/** The normalized tokens of a text (a script line, a word of a take). */
export function tokensOf(text: string): string[] {
  return normalizeWord(text).split(/\s+/).filter(Boolean);
}
