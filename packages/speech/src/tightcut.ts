import type { Range } from "./takes";
import type { Word } from "./words";

// Tight cut: the pauses between words are cut out of the main track, with a
// small handle kept on each side. A cut always falls between the end of a
// word and the start of the next, never inside one.

export type TightCutOptions = {
  // Pauses longer than this are cut (seconds).
  minPause?: number;
  // Frames kept on each side of a cut.
  handleFrames?: number;
  fps?: number;
};

export type TightCut = {
  clips: Range[];
  pausesCut: number;
  removedSeconds: number;
};

const EPSILON = 1e-6;

/**
 * Cuts every pause longer than `minPause` inside each range. The words are
 * in source seconds, like the ranges; the clips returned replace the ranges.
 */
export function tightCut(
  ranges: Range[],
  words: Word[],
  { minPause = 0.15, handleFrames = 2, fps = 30 }: TightCutOptions = {},
): TightCut {
  const handle = handleFrames / fps;
  const clips: Range[] = [];
  let pausesCut = 0;
  let removedSeconds = 0;
  for (const range of ranges) {
    const inside = words.filter(
      (w) => w.end > range.in + EPSILON && w.start < range.out - EPSILON,
    );
    if (inside.length === 0) {
      clips.push({ ...range });
      continue;
    }
    // A lead-in or tail longer than a pause is a pause too.
    const first = inside[0];
    let open = range.in;
    if (first.start - range.in > minPause + handle) {
      const start = Math.max(range.in, first.start - handle);
      removedSeconds += start - range.in;
      pausesCut++;
      open = start;
    }
    for (let i = 0; i + 1 < inside.length; i++) {
      const a = inside[i];
      const b = inside[i + 1];
      const gap = b.start - a.end;
      if (gap <= minPause + 2 * handle) continue;
      const close = Math.min(range.out, a.end + handle);
      const reopen = Math.max(range.in, b.start - handle);
      if (reopen - close <= EPSILON) continue;
      clips.push({ in: open, out: close });
      removedSeconds += reopen - close;
      pausesCut++;
      open = reopen;
    }
    const last = inside[inside.length - 1];
    let close = range.out;
    if (range.out - last.end > minPause + handle) {
      close = Math.min(range.out, last.end + handle);
      removedSeconds += range.out - close;
      pausesCut++;
    }
    if (close - open > EPSILON) clips.push({ in: open, out: close });
  }
  return { clips, pausesCut, removedSeconds };
}

/** True when `t` falls strictly inside a word (a cut there would clip it). */
export function insideWord(words: Word[], t: number, tolerance = 0): boolean {
  return words.some((w) => t > w.start + tolerance && t < w.end - tolerance);
}
