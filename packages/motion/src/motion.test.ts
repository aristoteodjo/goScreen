import { describe, expect, it } from "vitest";
import {
  ASSET_BASE,
  cleanWords,
  labelsFor,
  visualPath,
  visualsFor,
  fidelity,
  measureShots,
  type Observations,
  type ObservedVisual,
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
  visuals: [],
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

const visual = (extra: Partial<ObservedVisual> = {}): ObservedVisual => ({
  kind: "image",
  image: "reference.visual-1.png",
  box: { x: 1500, y: 100, w: 208, h: 108 },
  start: 0.2,
  settled: 0.5,
  end: 1.6,
  changes: 0,
  path: [
    { t: 0.25, x: 1504, y: 104, w: 200, h: 100 },
    { t: 0.5, x: 1504, y: 104, w: 200, h: 100 },
  ],
  ...extra,
});

describe("visuals", () => {
  it("keeps a picture beside the text, not the text itself nor its underline", () => {
    const words = [word("Chaque", 197, 0.15)];
    const o = obs(words, {
      visuals: [
        visual(),
        // The word while it comes in, blurred: OCR could not read it.
        visual({ image: "reference.visual-2.png", box: { x: 190, y: 540, w: 520, h: 140 } }),
        // The underline.
        visual({ image: "reference.visual-3.png", box: { x: 190, y: 655, w: 1100, h: 10 } }),
      ],
    });
    const found = visualsFor(o, 0, 2, words);
    expect(found.map((v) => v.src)).toEqual(["reference.visual-1.png"]);
    expect(found[0]).toMatchObject({ x: 0.7813, y: 0.0926, at: 0.2, fadeIn: 0.3, until: 1.6, path: [] });
    const spec = specFromObservations(o);
    expect(spec.shots[0].visuals).toHaveLength(1);
  });

  it("follows a picture that slides in from the left edge", () => {
    const v = visual({
      path: [
        { t: 0, x: 0, y: 104, w: 100, h: 100 },
        { t: 0.25, x: 0, y: 104, w: 200, h: 100 },
        { t: 0.5, x: 300, y: 104, w: 200, h: 100 },
        { t: 0.75, x: 300, y: 104, w: 200, h: 100 },
      ],
    });
    const path = visualPath(v, 1920, 1080);
    // Half of it out of the frame: its centre is at the edge, full size.
    expect(path[0]).toMatchObject({ t: 0, x: 0, scale: 1 });
    expect(path.at(-1)).toMatchObject({ x: round4(400 / 1920), scale: 1 });
    expect(visualPath(visual(), 1920, 1080)).toEqual([]);
    expect(visualPath(visual({ kind: "clip" }), 1920, 1080)).toEqual([]);
  });

  it("draws the big words of a slide as labels, unless a picture holds them", () => {
    const words = [word("Audit", 197, 0.15), word("1281", 1550, 0.15, { box: { x: 1550, y: 130, w: 100, h: 50 } })];
    const o = obs(words, { visuals: [visual()] });
    const pictures = visualsFor(o, 0, 2, null);
    expect(labelsFor(o, words, pictures).map((l) => l.text)).toEqual(["Audit"]);
  });

  it("renders pictures from the assets, and clips as videos", () => {
    const o = obs([], { visuals: [visual(), visual({ kind: "clip", image: "reference.visual-2.webm" })], cuts: [] });
    const spec = specFromObservations(o);
    expect(spec.shots[0]).toMatchObject({ kind: "placeholder", label: "picture" });
    const html = specHtml(spec);
    expect(html).toContain(`data-assets="${ASSET_BASE}"`);
    expect(html).toContain("reference.visual-2.webm");
    expect(parseMotionSpec({ ...spec, shots: [{ ...spec.shots[0], visuals: [{ ...spec.shots[0].visuals[0], src: "../x.png" }] }] }).ok).toBe(false);
  });

  it("measures the pictures a rendering shows", () => {
    const ref = obs([], { visuals: [visual()], cuts: [] });
    const spec = specFromObservations(ref);
    expect(measureShots(spec, ref, ref)[0]).toMatchObject({ kind: "placeholder", refVisuals: 1, visuals: 1 });
    const [m] = measureShots(spec, ref, { ...ref, visuals: [] });
    expect(m.visuals).toBe(0);
    expect(fidelity(m)).toBe(0);
  });
});

const round4 = (n: number) => Math.round(n * 10000) / 10000;
