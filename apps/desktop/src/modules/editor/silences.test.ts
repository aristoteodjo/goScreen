import type { AudioClip } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { soundRanges, stripSilences, trimSilentEnds } from "./silences";

const opts = { pad: 0.1, minSound: 0.15 };

const clip: AudioClip = {
  id: "aud-1",
  lane: 0,
  start: 10,
  duration: 8,
  asset: "voice",
  in: 1,
  volume: 1,
  fadeIn: 0.05,
  fadeOut: 0.15,
};

describe("soundRanges", () => {
  it("keeps the sound between pauses, padded toward the words", () => {
    expect(
      soundRanges(
        [0, 10],
        [
          { start: 0, end: 1 },
          { start: 4, end: 6 },
          { start: 9, end: null },
        ],
        opts,
      ),
    ).toEqual([
      [0.9, 4.1],
      [5.9, 9.1],
    ]);
  });

  it("drops bits of sound too short to be a word", () => {
    expect(
      soundRanges(
        [0, 10],
        [
          { start: 1, end: 3 },
          { start: 3.05, end: 6 },
        ],
        opts,
      ),
    ).toEqual([
      [0, 1.1],
      [5.9, 10],
    ]);
  });

  it("is the whole window when nothing is silent, empty when all is", () => {
    expect(soundRanges([2, 5], [], opts)).toEqual([[2, 5]]);
    expect(soundRanges([2, 5], [{ start: 0, end: null }], opts)).toEqual([]);
  });
});

describe("stripSilences", () => {
  it("splits the clip in place, so the voice keeps its sync", () => {
    let n = 0;
    const pieces = stripSilences(
      clip,
      [{ start: 3, end: 5 }],
      opts,
      () => `new-${++n}`,
    );
    expect(pieces.map((p) => [p.id, p.start, p.in, p.duration])).toEqual([
      ["aud-1", 10, 1, 2.1],
      ["new-1", 13.9, 4.9, 4.1],
    ]);
    // Each piece plays the same file time at the same timeline time.
    for (const p of pieces) expect(p.start - p.in).toBeCloseTo(9);
    expect(pieces[0].fadeIn).toBe(0.05);
    expect(pieces[1].fadeOut).toBe(0.15);
  });
});

describe("trimSilentEnds", () => {
  it("cuts the silence before the first word and after the last", () => {
    const trimmed = trimSilentEnds(
      clip,
      [
        { start: 0, end: 2 },
        { start: 4, end: 4.3 },
        { start: 8, end: null },
      ],
      opts,
    );
    expect(trimmed && [trimmed.start, trimmed.in, trimmed.duration]).toEqual([
      10.9, 1.9, 6.2,
    ]);
  });

  it("is null for a silent take", () => {
    expect(trimSilentEnds(clip, [{ start: 0, end: null }], opts)).toBeNull();
  });
});
