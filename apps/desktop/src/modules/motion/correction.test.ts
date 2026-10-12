import { ShotReview } from "@goscreen/motion";
import { describe, expect, it } from "vitest";
import { linesToText, textToLines } from "./correction";

describe("correction text", () => {
  it("reads accents, strikes and lines", () => {
    expect(textToLines("L'IA  *qui*\n~vend~ *~tout~*\n\n")).toEqual([
      [
        { text: "L'IA", accent: false, strike: false },
        { text: "qui", accent: true, strike: false },
      ],
      [
        { text: "vend", accent: false, strike: true },
        { text: "tout", accent: true, strike: true },
      ],
    ]);
  });

  it("keeps a lone mark as a word", () => {
    expect(textToLines("* ~")).toEqual([
      [
        { text: "*", accent: false, strike: false },
        { text: "~", accent: false, strike: false },
      ],
    ]);
  });

  it("round-trips an answer", () => {
    const r = ShotReview.parse({
      kind: "text",
      lines: [[{ text: "Vendez", accent: true, strike: false }], [{ text: "plus.", accent: false, strike: true }]],
    });
    expect(textToLines(linesToText(r.lines))).toEqual(r.lines);
  });
});
