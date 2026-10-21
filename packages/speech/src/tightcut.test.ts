import { describe, expect, it } from "vitest";
import { insideWord, tightCut } from "./tightcut";
import type { Word } from "./words";

const w = (text: string, start: number, end: number): Word => ({
  text,
  start,
  end,
  p: 0.9,
});

describe("tightCut", () => {
  const words = [
    w("one", 0.5, 0.8),
    w("two", 0.85, 1.1),
    w("three", 1.6, 1.9),
    w("four", 1.95, 2.2),
    w("five", 3.0, 3.3),
  ];

  it("cuts pauses longer than minPause with a handle each side", () => {
    const { clips, pausesCut, removedSeconds } = tightCut(
      [{ in: 0, out: 4 }],
      words,
      { minPause: 0.15, handleFrames: 2, fps: 30 },
    );
    const h = 2 / 30;
    expect(
      clips.map((c) => [c.in, c.out].map((v) => Number(v.toFixed(4)))),
    ).toEqual(
      [
        [0.5 - h, 1.1 + h],
        [1.6 - h, 2.2 + h],
        [3.0 - h, 3.3 + h],
      ].map((c) => c.map((v) => Number(v.toFixed(4)))),
    );
    // The lead-in, two pauses and the tail.
    expect(pausesCut).toBe(4);
    expect(removedSeconds).toBeCloseTo(
      4 - clips.reduce((s, c) => s + c.out - c.in, 0),
      6,
    );
  });

  it("never cuts inside a word", () => {
    const { clips } = tightCut([{ in: 0, out: 4 }], words);
    for (const c of clips) {
      expect(insideWord(words, c.in)).toBe(false);
      expect(insideWord(words, c.out)).toBe(false);
    }
  });

  it("keeps short pauses and ranges without words", () => {
    const { clips, pausesCut } = tightCut([{ in: 0.5, out: 1.1 }], words);
    expect(clips).toEqual([{ in: 0.5, out: 1.1 }]);
    expect(pausesCut).toBe(0);
    expect(tightCut([{ in: 5, out: 6 }], words).clips).toEqual([
      { in: 5, out: 6 },
    ]);
  });

  it("respects a larger minPause", () => {
    const { clips } = tightCut([{ in: 0.5, out: 2.2 }], words, {
      minPause: 0.6,
    });
    expect(clips).toEqual([{ in: 0.5, out: 2.2 }]);
  });
});

describe("insideWord", () => {
  it("is strict at the edges", () => {
    const words = [w("a", 1, 1.5)];
    expect(insideWord(words, 1)).toBe(false);
    expect(insideWord(words, 1.5)).toBe(false);
    expect(insideWord(words, 1.2)).toBe(true);
    expect(insideWord(words, 1.02, 0.05)).toBe(false);
  });
});
