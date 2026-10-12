import { describe, expect, it } from "vitest";
import {
  cleanWords,
  fidelity,
  measureShots,
  type Observations,
  type ObservedWord,
  parseMotionSpec,
  specFromObservations,
  specHtml,
} from "./index.ts";

const word = (text: string, x: number, start: number, extra: Partial<ObservedWord> = {}): ObservedWord => ({
  text,
  conf: 95,
  seen: 4,
  box: { x, y: 488, w: 300, h: 115 },
  color: "#0b0f19",
  start,
  settled: start + 0.1,
  end: 1.4,
  ...extra,
});

const obs = (words: ObservedWord[], extra: Partial<Observations> = {}): Observations => ({
  version: 1,
  source: "ref.mp4",
  width: 1920,
  height: 1080,
  fps: 60,
  duration: 4,
  cuts: [2],
  backgrounds: [{ t: 0, color: "#ffffff" }, { t: 3, color: "#0b0f19" }],
  rules: [{ t: 0.5, x: 190, y: 657, w: 1100, h: 6, color: "#1b4dff" }],
  words,
  ...extra,
});

describe("parseMotionSpec", () => {
  it("names the wrong field", () => {
    const r = parseMotionSpec({
      version: 1, width: 1920, height: 1080, fps: 30, duration: 2,
      shots: [{ kind: "placeholder", id: "a", start: 1, end: 1, background: "#000000" }],
    });
    expect(r).toEqual({ ok: false, error: "shots.0.end: A shot must end after it starts." });
  });
});

describe("specFromObservations", () => {
  const spec = specFromObservations(
    obs([
      word("Chaque", 197, 0.15),
      word("semaine,", 741, 0.4, { color: "#1c4bf2" }),
      // OCR read the same word twice, less surely.
      word("Chaquc", 200, 0.2, { conf: 60, seen: 1 }),
    ]),
  );

  it("makes a text shot, then a placeholder after the cut", () => {
    expect(spec.shots.map((s) => [s.kind, s.start, s.end])).toEqual([
      ["text", 0, 2],
      ["placeholder", 2, 4],
    ]);
  });

  it("keeps the words in order, with their timing and accent", () => {
    const shot = spec.shots[0];
    if (shot.kind !== "text") throw new Error("text shot expected");
    expect(shot.lines[0].words.map((w) => [w.text, w.at, w.accent])).toEqual([
      ["Chaque", 0.15, false],
      ["semaine,", 0.4, true],
    ]);
    expect(shot.underline?.offset).toBeGreaterThan(0);
    expect(shot.x).toBeCloseTo(197 / 1920, 3);
  });

  it("drops a weaker reading of the same word", () => {
    expect(cleanWords([word("Chaque", 197, 0.15), word("Chaquc", 200, 0.2, { conf: 60, seen: 1 })]).map((w) => w.text)).toEqual(["Chaque"]);
  });

  it("reads a much smaller row above as a kicker", () => {
    const s = specFromObservations(
      obs([word("OFFRES", 197, 0.1, { box: { x: 197, y: 400, w: 120, h: 14 } }), word("Un", 197, 0.2)], { cuts: [] }),
    ).shots[0];
    expect(s.kind === "text" && s.kicker?.text).toBe("OFFRES");
  });
});

describe("measureShots", () => {
  it("scores a rendering identical to its reference as perfect", () => {
    const o = obs([word("Chaque", 197, 0.15), word("semaine,", 741, 0.4)]);
    const spec = specFromObservations(o);
    const [m] = measureShots(spec, o, o);
    expect(m).toMatchObject({ recall: 1, precision: 1, timing: 0, position: 0, size: 0, color: 0 });
    expect(fidelity(m)).toBe(1);
  });

  it("compares a smaller rendering in fractions of the frame", () => {
    const ref = obs([word("Chaque", 200, 0.1)]);
    const half = obs([word("Chaque", 100, 0.1, { box: { x: 100, y: 244, w: 150, h: 57.5 } })], { width: 960, height: 540 });
    const [m] = measureShots(specFromObservations(ref), ref, half);
    expect(m.position).toBeCloseTo(0, 3);
    expect(m.size).toBeCloseTo(0, 3);
  });
});

describe("specHtml", () => {
  it("cannot be broken out of by a word", () => {
    const html = specHtml(specFromObservations(obs([word("</script><b>", 197, 0.1)])));
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("\\u003c/script>");
  });
});
