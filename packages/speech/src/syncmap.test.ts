import { describe, expect, it } from "vitest";
import { beatGaps, checkSync, findWord, syncMap } from "./syncmap";
import type { Word } from "./words";

function speak(text: string): Word[] {
  return text.split(/\s+/).map((t, i) => ({
    text: t,
    start: i * 0.5,
    end: i * 0.5 + 0.3,
    p: 0.9,
  }));
}

const words = speak("Voici goScreen. Zoom ici, et zoom là. Fin.");

describe("findWord", () => {
  it("finds the n-th occurrence, accents and case aside", () => {
    expect(findWord(words, "zoom")).toBe(2);
    expect(findWord(words, "ZOOM", 2)).toBe(5);
    expect(findWord(words, "zoom", -1)).toBe(5);
    expect(findWord(words, "zoom", 3)).toBeNull();
    expect(findWord(words, "goscreen")).toBe(1);
    expect(findWord(words, "zoom ici")).toBe(2);
    expect(findWord(words, "nope")).toBeNull();
  });
});

describe("syncMap", () => {
  it("places each effect on its word and lists the missing ones", () => {
    const { marks, missing } = syncMap(words, [
      { word: "là", effect: "text" },
      { word: "zoom", nth: 1, effect: "zoom" },
      { word: "absent", effect: "sfx" },
    ]);
    expect(marks.map((m) => [m.effect, m.t])).toEqual([
      ["zoom", 1],
      ["text", 3],
    ]);
    expect(missing).toEqual([{ word: "absent", nth: 1 }]);
  });
});

describe("checkSync", () => {
  it("accepts effects within two frames", () => {
    const checks = checkSync(
      [
        { t: 1.05, word: "zoom" },
        { t: 3.2, word: "là" },
        { t: 0, word: "nope" },
      ],
      words,
      { toleranceFrames: 2, fps: 30 },
    );
    expect(checks.map((c) => c.ok)).toEqual([true, false, false]);
    expect(checks[1].offsetFrames).toBe(6);
    expect(checks[2].expected).toBeNull();
  });
});

describe("beatGaps", () => {
  it("lists long gaps, stacked and rushed effects", () => {
    const gaps = beatGaps([1, 1.1, 2.5, 8], { min: 2, max: 4, end: 14 });
    expect(gaps.stacked).toEqual([{ a: 1, b: 1.1 }]);
    expect(gaps.rushed).toEqual([{ a: 1.1, b: 2.5 }]);
    expect(gaps.gaps).toEqual([
      { from: 2.5, to: 8, seconds: 5.5 },
      { from: 8, to: 14, seconds: 6 },
    ]);
    expect(beatGaps([5]).gaps).toEqual([{ from: 0, to: 5, seconds: 5 }]);
    expect(beatGaps([])).toEqual({ gaps: [], stacked: [], rushed: [] });
  });
});
