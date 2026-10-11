import type { AudioClip } from "@goscreen/render-engine";

// Cutting the pauses of a sound, the way an editor strips silence: the
// sound is split where it is silent and the pieces stay where they were,
// so a voice-over keeps its sync with the picture.

/** A silent stretch, in seconds of the file; `end` null runs to the end. */
export type Silence = { start: number; end: number | null };

export type SilenceOptions = {
  /** Below this level, the sound counts as silence. */
  thresholdDb: number;
  /** Shorter pauses are kept (breaths between words). */
  minSilence: number;
  /** Sound kept on each side of a cut, so words are not clipped. */
  pad: number;
  /** Shorter bits of sound are dropped (clicks, a lip noise). */
  minSound: number;
};

export const SILENCE_DEFAULTS: SilenceOptions = {
  thresholdDb: -42,
  minSilence: 0.45,
  pad: 0.12,
  minSound: 0.12,
};

/** The parts of a file window that hold sound, in file time. */
export function soundRanges(
  window: [number, number],
  silences: Silence[],
  options: Pick<SilenceOptions, "pad" | "minSound">,
): [number, number][] {
  const [from, to] = window;
  const sound: [number, number][] = [];
  let cursor = from;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const end = s.end ?? Number.POSITIVE_INFINITY;
    if (end <= from || s.start >= to) continue;
    if (s.start > cursor) sound.push([cursor, s.start]);
    cursor = Math.max(cursor, Math.min(to, end));
  }
  if (cursor < to) sound.push([cursor, to]);
  // Length is judged before padding, which would make a click look like a word.
  const ranges: [number, number][] = [];
  for (const [a, b] of sound) {
    if (b - a < options.minSound) continue;
    const padded: [number, number] = [
      Math.max(from, a - options.pad),
      Math.min(to, b + options.pad),
    ];
    const last = ranges[ranges.length - 1];
    if (last && padded[0] <= last[1]) last[1] = Math.max(last[1], padded[1]);
    else ranges.push(padded);
  }
  return ranges;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The clip split into its sounding pieces, each at its original time. */
export function stripSilences(
  clip: AudioClip,
  silences: Silence[],
  options: Pick<SilenceOptions, "pad" | "minSound">,
  newId: () => string,
): AudioClip[] {
  const ranges = soundRanges(
    [clip.in, clip.in + clip.duration],
    silences,
    options,
  );
  return ranges.map(([a, b], i) => {
    const duration = round(b - a);
    const half = duration / 2;
    return {
      ...clip,
      id: i === 0 ? clip.id : newId(),
      start: round(clip.start + (a - clip.in)),
      in: round(a),
      duration,
      fadeIn: Math.min(i === 0 ? clip.fadeIn : 0.03, half),
      fadeOut: Math.min(i === ranges.length - 1 ? clip.fadeOut : 0.06, half),
    };
  });
}

/** The clip without the silence before the first word and after the last. */
export function trimSilentEnds(
  clip: AudioClip,
  silences: Silence[],
  options: Pick<SilenceOptions, "pad" | "minSound">,
): AudioClip | null {
  const ranges = soundRanges(
    [clip.in, clip.in + clip.duration],
    silences,
    options,
  );
  if (ranges.length === 0) return null;
  const a = ranges[0][0];
  const b = ranges[ranges.length - 1][1];
  return {
    ...clip,
    start: round(clip.start + (a - clip.in)),
    in: round(a),
    duration: round(b - a),
  };
}
