import { describe, expect, it } from "vitest";
import {
  type Envelope,
  normalizeWord,
  onsetsOf,
  parseWords,
  snapToOnset,
  tokensOf,
} from "./words";

/** An envelope at 10 ms with attacks (loud stretches) at the given seconds. */
function envelope(attacks: [number, number][], seconds = 5): Envelope {
  const dt = 0.01;
  const rms = Array.from({ length: Math.round(seconds / dt) }, (_, i) => {
    const t = i * dt;
    return attacks.some(([a, b]) => t >= a && t < b) ? 0.5 : 0.01;
  });
  return { dt, rms };
}

describe("words file", () => {
  it("parses the contract and drops broken words", () => {
    const file = parseWords({
      language: "fr",
      source: "whisper",
      words: [
        { text: "deux", start: 1, end: 1.4, p: 0.9 },
        { text: "un", start: 0, end: 0.3, p: 0.8 },
        { text: "bad", start: 2, end: 1, p: 0.5 },
      ],
    });
    expect(file?.words.map((w) => w.text)).toEqual(["un", "deux"]);
    expect(parseWords({ words: [] })).toBeNull();
    expect(parseWords({ language: "fr", source: "x", words: [] })).toBeNull();
  });

  it("normalizes accents, case and punctuation", () => {
    expect(normalizeWord("Élève,")).toBe("eleve");
    expect(tokensOf("L'appli — c'est  Génial !")).toEqual([
      "lappli",
      "cest",
      "genial",
    ]);
    expect(tokensOf("Essayez-le aujourd'hui - vite")).toEqual([
      "essayezle",
      "aujourdhui",
      "vite",
    ]);
  });
});

describe("onsets", () => {
  it("finds each rise through the relative threshold", () => {
    const env = envelope([
      [1, 1.5],
      [2.2, 2.6],
    ]);
    const onsets = onsetsOf(env);
    expect(onsets.map((t) => Number(t.toFixed(2)))).toEqual([1, 2.2]);
    expect(onsetsOf({ dt: 0.01, rms: [0.1, 0.1, 0.1] })).toEqual([]);
  });
});

describe("snapToOnset", () => {
  const word = (text: string, start: number, end: number) => ({
    text,
    start,
    end,
    p: 0.9,
  });

  it("moves early STT starts onto the attack", () => {
    const env = envelope([
      [1, 1.5],
      [2.2, 2.6],
    ]);
    const words = [word("one", 0.75, 1.5), word("two", 1.95, 2.6)];
    const snapped = snapToOnset(words, env);
    expect(snapped[0].start).toBeCloseTo(1, 5);
    expect(snapped[1].start).toBeCloseTo(2.2, 5);
    expect(snapped[0].end).toBe(1.5);
  });

  it("never moves further than maxShift", () => {
    const env = envelope([[1, 1.5]]);
    const words = [word("one", 0.4, 1.5)];
    expect(snapToOnset(words, env, { maxShift: 0.35 })[0].start).toBe(0.4);
    expect(snapToOnset(words, env, { maxShift: 0.7 })[0].start).toBeCloseTo(1);
  });

  it("never passes the end of the word nor the previous word's end", () => {
    const env = envelope([[1.3, 1.8]]);
    // The onset lies after this word's end: it stays put.
    expect(snapToOnset([word("a", 1.1, 1.25)], env)[0].start).toBe(1.1);
    // The previous word ends after the onset: the start is held at that end.
    const words = [word("a", 0.9, 1.4), word("b", 1.2, 1.8)];
    const snapped = snapToOnset(words, env);
    expect(snapped[1].start).toBe(1.4);
    expect(snapped[1].start).toBeLessThan(snapped[1].end);
  });

  it("keeps words as they are without onsets", () => {
    const words = [word("a", 0.5, 0.9)];
    expect(snapToOnset(words, { dt: 0.01, rms: [] })).toEqual(words);
  });
});
