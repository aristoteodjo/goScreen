import { describe, expect, it } from "vitest";
import {
  CAPTION_PLACE,
  captionOverlays,
  captionStateAt,
  captionsFromWords,
  isCaptionOverlay,
  srtOf,
  srtTime,
} from "./captions";
import { parseEditState } from "./schema";
import { DEFAULT_EDIT } from "./schema";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("captionsFromWords", () => {
  it("groups up to four words and breaks on pauses, length and sentences", () => {
    const words = [
      w("We", 0, 0.2),
      w("ship", 0.25, 0.5),
      w("faster.", 0.55, 0.9),
      w("Every", 1.0, 1.2),
      w("single", 1.25, 1.5),
      w("day", 1.55, 1.8),
      w("now", 1.85, 2.0),
      w("really", 2.05, 2.3),
      w("late", 3.5, 3.8),
    ];
    const groups = captionsFromWords(words);
    expect(groups.map((g) => g.words.map((x) => x.text).join(" "))).toEqual([
      "We ship faster.",
      "Every single day now",
      "really",
      "late",
    ]);
    // A group holds a little after its last word, never into the next one.
    expect(groups[0].end).toBe(1.0);
    expect(groups[2].end).toBeCloseTo(2.7, 3);
    expect(groups[3].end).toBeCloseTo(4.1, 3);
    const long = captionsFromWords(
      [w("a", 0, 1), w("b", 1.05, 2), w("c", 2.05, 3)],
      { maxSeconds: 2.2 },
    );
    expect(long.length).toBe(2);
    expect(captionsFromWords([])).toEqual([]);
  });

  it("writes overlays the schema accepts, placed in the format's safe zone", () => {
    const groups = captionsFromWords([w("Hello", 1, 1.3), w("there", 1.35, 1.7)]);
    const overlays = captionOverlays(groups, {
      aspect: "9:16",
      font: "Inter",
      color: "#ffffff",
      accent: "#ffcc00",
      lane: 3,
    });
    expect(overlays).toHaveLength(1);
    const o = overlays[0];
    expect(o.id).toBe("caption-word-0");
    expect(isCaptionOverlay(o)).toBe(true);
    expect(o.start).toBe(1);
    expect(o.y).toBe(CAPTION_PLACE["9:16"].y);
    expect(o.y + o.height / 2).toBeLessThan(1 - 0.22);
    expect(o.words).toEqual([
      { text: "Hello", start: 0, end: 0.3 },
      { text: "there", start: 0.35, end: 0.7 },
    ]);
    const parsed = parseEditState({ ...DEFAULT_EDIT, overlays });
    expect(parsed?.overlays[0]).toMatchObject({ kind: "text", words: o.words });
  });

  it("gives each word its state: fade in, the spoken one active and popping", () => {
    const words = [
      { text: "a", start: 0, end: 0.3 },
      { text: "b", start: 0.4, end: 0.7 },
    ];
    const at = (t: number) => captionStateAt(words, t, 1);
    expect(at(0)[0]).toMatchObject({ opacity: 0, active: true });
    expect(at(0.04)[0].opacity).toBeCloseTo(0.5, 5);
    expect(at(0.04)[0].scale).toBeGreaterThan(1);
    expect(at(0.04)[1]).toMatchObject({ opacity: 0, active: false, scale: 1 });
    expect(at(0.5)[0]).toMatchObject({ opacity: 1, active: false });
    expect(at(0.5)[1].active).toBe(true);
    expect(at(0.5)[1].scale).toBeGreaterThan(1);
    expect(at(0.8)[1].scale).toBeCloseTo(1, 3);
    // Everything fades 80 ms before the group ends.
    expect(at(0.96)[0].opacity).toBeCloseTo(0.5, 5);
  });

  it("writes SubRip cues of at most seven words", () => {
    expect(srtTime(3661.5)).toBe("01:01:01,500");
    const words = Array.from({ length: 9 }, (_, i) =>
      w(`w${i}`, i * 0.3, i * 0.3 + 0.2),
    );
    const srt = srtOf(words);
    expect(srt.startsWith("1\n00:00:00,000 --> ")).toBe(true);
    expect(srt).toContain("w0 w1 w2 w3 w4 w5 w6\n");
    expect(srt).toContain("\n2\n");
    expect(srt).toContain("w7 w8\n");
  });
});
