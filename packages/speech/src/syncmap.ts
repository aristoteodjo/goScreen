import { type Word, tokensOf } from "./words";

// Sync map: the person names their effects as they speak ("...and here,
// zoom"); each effect is tied to a word (its n-th occurrence) and lands on
// that word's start, in source seconds.

export type SyncEntry<E = unknown> = {
  // One word, or a few words in a row.
  word: string;
  // 1-based occurrence; -1 is the last one.
  nth?: number;
  effect: E;
};

export type SyncMark<E = unknown> = {
  t: number;
  effect: E;
  word: string;
  nth: number;
  // Index of the first word in `words`.
  index: number;
};

export type SyncMapResult<E = unknown> = {
  marks: SyncMark<E>[];
  missing: { word: string; nth: number }[];
};

/** Indices of every occurrence of a word (or phrase), accents and case ignored. */
export function occurrencesOf(words: Word[], phrase: string): number[] {
  const wanted = tokensOf(phrase);
  if (wanted.length === 0) return [];
  const tokens = words.map((w) => tokensOf(w.text).join(""));
  const out: number[] = [];
  for (let i = 0; i + wanted.length <= tokens.length; i++)
    if (wanted.every((t, k) => tokens[i + k] === t)) out.push(i);
  return out;
}

/** The index of the n-th occurrence (-1: the last), or null. */
export function findWord(
  words: Word[],
  phrase: string,
  nth = 1,
): number | null {
  const all = occurrencesOf(words, phrase);
  if (all.length === 0) return null;
  const index = nth < 0 ? all.length + nth : nth - 1;
  return all[index] ?? null;
}

/** Resolves each entry to the start of its word; unresolved ones are listed. */
export function syncMap<E>(
  words: Word[],
  entries: SyncEntry<E>[],
): SyncMapResult<E> {
  const marks: SyncMark<E>[] = [];
  const missing: { word: string; nth: number }[] = [];
  for (const e of entries) {
    const nth = e.nth ?? 1;
    const index = findWord(words, e.word, nth);
    if (index === null) missing.push({ word: e.word, nth });
    else
      marks.push({
        t: words[index].start,
        effect: e.effect,
        word: e.word,
        nth,
        index,
      });
  }
  marks.sort((a, b) => a.t - b.t);
  return { marks, missing };
}

export type SyncCheck = {
  word: string;
  nth: number;
  t: number;
  expected: number | null;
  offsetFrames: number | null;
  ok: boolean;
};

export type CheckOptions = { toleranceFrames?: number; fps?: number };

/** Whether every placed effect sits within the tolerance of its word's start. */
export function checkSync(
  effectsAt: { t: number; word: string; nth?: number }[],
  words: Word[],
  { toleranceFrames = 2, fps = 30 }: CheckOptions = {},
): SyncCheck[] {
  return effectsAt.map((e) => {
    const nth = e.nth ?? 1;
    const index = findWord(words, e.word, nth);
    if (index === null)
      return {
        word: e.word,
        nth,
        t: e.t,
        expected: null,
        offsetFrames: null,
        ok: false,
      };
    const expected = words[index].start;
    const offsetFrames = Math.round((e.t - expected) * fps);
    return {
      word: e.word,
      nth,
      t: e.t,
      expected,
      offsetFrames,
      ok: Math.abs(e.t - expected) <= toleranceFrames / fps + 1e-6,
    };
  });
}

export type BeatGaps = {
  // Stretches with no change for longer than `max` seconds.
  gaps: { from: number; to: number; seconds: number }[];
  // Pairs of effects closer than `stack` seconds.
  stacked: { a: number; b: number }[];
  // Changes closer than `min` seconds (too busy).
  rushed: { a: number; b: number }[];
};

export type BeatOptions = {
  min?: number;
  max?: number;
  stack?: number;
  end?: number;
};

/** Where the rhythm breaks: long stretches without a change, piled-up effects. */
export function beatGaps(
  times: number[],
  { min = 2, max = 4, stack = 0.2, end }: BeatOptions = {},
): BeatGaps {
  const sorted = [...times].sort((a, b) => a - b);
  const out: BeatGaps = { gaps: [], stacked: [], rushed: [] };
  const points =
    end !== undefined && sorted.length > 0 ? [...sorted, end] : sorted;
  if (sorted.length > 0 && sorted[0] > max)
    out.gaps.push({ from: 0, to: sorted[0], seconds: sorted[0] });
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seconds = b - a;
    if (seconds > max) out.gaps.push({ from: a, to: b, seconds });
    if (i + 1 < sorted.length) {
      if (seconds < stack) out.stacked.push({ a, b });
      else if (seconds < min) out.rushed.push({ a, b });
    }
  }
  return out;
}
