import { describe, expect, it } from "vitest";
import { applyReview, reviewsAgree, ShotReview, shotKeyTime, spreadTimes, type TextShot } from "./index.ts";

const shot: TextShot = {
  kind: "text", id: "s", start: 10, end: 12, background: "#ffffff", ink: "#0b0f19", accent: "#1f4fe8",
  x: 0.1, y: 0.55, size: 0.13, weight: 600, lineHeight: 1.1,
  lines: [{ words: [
    { text: "LIA", at: 10.2, accent: false, echo: false },
    { text: "qui", at: 10.25, accent: false, echo: false },
    { text: "travaille,", at: 10.3, accent: true, echo: false },
  ] }],
  enter: { y: 0.35, blur: 0.12, duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  exit: "cut",
  visuals: [],
};

describe("applyReview", () => {
  it("corrects the words and keeps the measured timing", () => {
    const review = ShotReview.parse({ kind: "text", lines: [[{ text: "L'IA" }, { text: "qui" }, { text: "travaille,", accent: true }]] });
    const next = applyReview(shot, review);
    expect(next.kind === "text" && next.lines[0].words.map((w) => [w.text, w.at, w.accent])).toEqual([
      ["L'IA", 10.2, false], ["qui", 10.25, false], ["travaille,", 10.3, true],
    ]);
  });

  it("spreads the timing when the AI finds more words", () => {
    const review = ShotReview.parse({ kind: "text", lines: [[{ text: "Il" }, { text: "est" }, { text: "temps" }]] });
    const one = { ...shot, lines: [{ words: [{ text: "temps", at: 5.75, accent: false, echo: false }] }] };
    const next = applyReview(one, review);
    expect(next.kind === "text" && next.lines[0].words.map((w) => w.at)).toEqual([5.75, 5.75, 5.75]);
  });

  it("strikes a word the AI sees struck", () => {
    const review = ShotReview.parse({ kind: "text", lines: [[{ text: "pas" }, { text: "slides.", strike: true }]] });
    const next = applyReview(shot, review);
    expect(next.kind === "text" && next.lines[0].words[1].strike).toBeGreaterThan(next.kind === "text" ? next.lines[0].words[1].at : 0);
  });

  it("turns a logo into a named placeholder", () => {
    const next = applyReview(shot, ShotReview.parse({ kind: "logo", description: "REMAIN logo with a glow" }));
    expect(next).toMatchObject({ kind: "placeholder", label: "REMAIN logo with a glow", start: 10, end: 12 });
  });
});

it("spreadTimes keeps measured times when counts match", () => {
  expect(spreadTimes([1, 2], 2)).toEqual([1, 2]);
  expect(spreadTimes([1, 2], 3)).toEqual([1, 1.5, 2]);
});

it("shotKeyTime waits for the last word, within the shot", () => {
  expect(shotKeyTime(shot)).toBeCloseTo(10.9, 5);
});

describe("elements", () => {
  it("reads older answers without background or elements, and judges them when given", () => {
    const old = ShotReview.parse({ kind: "interface", lines: [], kicker: null, description: "x" });
    expect(old.background).toBeNull();
    expect(old.elements).toEqual([]);
    const a = ShotReview.parse({ ...old, background: { kind: "gradient", colors: ["#ffffff"] }, elements: [{ role: "window", shadow: true }] });
    const b = ShotReview.parse({ ...old, background: { kind: "plain", colors: [] } });
    expect(reviewsAgree(a, a)).toBe(true);
    expect(reviewsAgree(a, b)).toBe(false);
  });
});

describe("applyReview keeps what was measured", () => {
  it("keeps a counter and places when the teacher adds a line it saw in a picture", () => {
    const counter: TextShot = {
      ...shot,
      lines: [
        { words: [{ text: "14", at: 10.2, accent: false, echo: false, x: 0.3, w: 0.2, count: { from: 0, start: 10, end: 10.5 } }] },
        { words: [{ text: "free", at: 10.6, accent: false, echo: false, x: 0.2, w: 0.08 }, { text: "TikTok", at: 10.7, accent: false, echo: false, x: 0.3, w: 0.1 }] },
      ],
    };
    const review = ShotReview.parse({
      kind: "text",
      lines: [
        [{ text: "14" }],
        [{ text: "free" }, { text: "TikTok" }, { text: "tools" }],
        [{ text: "No" }, { text: "signup." }],
      ],
    });
    const next = applyReview(counter, review);
    expect(next.kind).toBe("text");
    if (next.kind !== "text") return;
    // The pills' line was not measured: learnt, not drawn.
    expect(next.lines).toHaveLength(2);
    expect(next.lines[0].words[0].count).toEqual({ from: 0, start: 10, end: 10.5 });
    expect(next.lines[1].words.map((w) => [w.text, w.x])).toEqual([["free", 0.2], ["TikTok", 0.3], ["tools", undefined]]);
  });
});
