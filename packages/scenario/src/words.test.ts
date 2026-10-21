import { describe, expect, it } from "vitest";
import {
  parseWordsFile,
  wordsBetween,
  wordsFileOf,
  wordsFileSchema,
} from "./words";

describe("words file", () => {
  it("accepts the shared contract", () => {
    const file = wordsFileSchema.parse({
      language: "fr",
      source: "whisper",
      words: [{ text: "Bonjour", start: 0.2, end: 0.6, p: 0.98 }],
    });
    expect(file.words[0].text).toBe("Bonjour");
  });

  it("drops a bad word alone and sorts the rest", () => {
    const file = parseWordsFile({
      language: "en",
      source: "manual",
      words: [
        { text: "two", start: 1, end: 1.4 },
        { text: "", start: 0, end: 0.1 },
        { text: "late", start: 2, end: 1 },
        { text: "one", start: 0.1, end: 0.5, p: 2 },
      ],
    });
    expect(file?.words.map((w) => w.text)).toEqual(["one", "two"]);
    expect(file?.words[0].p).toBe(1);
    expect(parseWordsFile({ words: "no" })).toBeNull();
    expect(parseWordsFile(null)).toBeNull();
  });

  it("names the sidecar and picks a range", () => {
    expect(wordsFileOf("/v/take.mp4")).toBe("/v/take.words.json");
    expect(wordsFileOf("/v/my.take.mov")).toBe("/v/my.take.words.json");
    const words = [
      { text: "a", start: 0, end: 0.2, p: 1 },
      { text: "b", start: 1, end: 1.2, p: 1 },
      { text: "c", start: 2, end: 2.2, p: 1 },
    ];
    expect(wordsBetween(words, 1, 2).map((w) => w.text)).toEqual(["b"]);
  });
});
