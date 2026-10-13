import { parseEditState } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import {
  ASSET_BASE,
  aspectOf,
  specToEdit,
  cleanWords,
  counterOf,
  wordPath,
  labelsFor,
  lookAlike,
  onPicture,
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
  masked: true,
  mark: false,
  path: [],
  around: null,
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
  plates: [],
  thumbs: null,
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
        visual({ image: "reference.visual-2.png", box: { x: 190, y: 500, w: 320, h: 130 } }),
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

  it("draws every word the pictures were cut without as a label, covered in them", () => {
    const words = [
      word("Audit", 197, 0.15),
      word("1281", 1550, 0.15, { box: { x: 1550, y: 130, w: 100, h: 50 }, around: "#ffffff" }),
      word("semaine", 197, 0.15, { masked: false, box: { x: 197, y: 620, w: 90, h: 20 } }),
    ];
    const o = obs(words, { visuals: [visual()] });
    expect(labelsFor(o, words).map((l) => l.text)).toEqual(["Audit", "1281"]);
    // The dashboard's own figure is hidden under the label.
    expect(visualsFor(o, 0, 2, null, words)[0].covers).toHaveLength(1);
  });

  it("keeps a chip around a word of a text shot, not the word alone", () => {
    const words = [word("Saisie", 261, 0.15, { box: { x: 261, y: 559, w: 153, h: 43 } })];
    const o = obs(words, {
      visuals: [
        visual({ image: "chip.png", box: { x: 184, y: 528, w: 272, h: 112 } }),
        visual({ image: "blur.png", box: { x: 255, y: 550, w: 165, h: 60 } }),
      ],
    });
    const [chip, ...rest] = visualsFor(o, 0, 2, words.map((w) => ({ ...w, around: "#ffffff" })));
    expect(rest).toEqual([]);
    expect(chip.src).toBe("chip.png");
    // The word inside it is hidden while it is there; the text is drawn over.
    expect(chip.covers).toHaveLength(1);
    expect(chip.covers[0]).toMatchObject({ color: "#ffffff", at: 0, until: 1.6 });
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

describe("lettering", () => {
  it("leaves a logo's lettering and stray letters out of the text", () => {
    const o = obs([
      word("Chaque", 197, 0.15),
      word("A", 900, 0.2, { seen: 1, conf: 97, box: { x: 900, y: 700, w: 9, h: 15 } }),
      word("REMAIN", 600, 0.3, { mark: true, masked: false, box: { x: 600, y: 300, w: 699, h: 83 } }),
    ]);
    const shot = specFromObservations(o).shots[0];
    expect(shot.kind === "text" && shot.lines.flatMap((l) => l.words.map((w) => w.text))).toEqual(["Chaque"]);
  });
});

describe("onPicture", () => {
  const words = [word("1281", 600, 0.15)];
  it("gives the words of a dashboard to its picture", () => {
    const o = obs(words, { visuals: [visual({ box: { x: 400, y: 300, w: 1000, h: 600 }, start: 0, end: 2 })] });
    expect(onPicture(o, words)).toBe(true);
    expect(specFromObservations(o).shots[0].kind).toBe("placeholder");
  });
  it("does not mistake the words, seen blurred, for a picture", () => {
    const o = obs(words, { visuals: [visual({ box: { x: 590, y: 480, w: 320, h: 130 }, start: 0, end: 2 })] });
    expect(onPicture(o, words)).toBe(false);
  });
});

describe("plates", () => {
  it("puts each shot over the plate of its cut, rendered under everything", () => {
    const o = obs([word("Chaque", 197, 0.15)], {
      plates: [{ start: 0, end: 2, image: "reference.plate-1.png", seen: 0.8 }],
    });
    const spec = specFromObservations(o);
    expect(spec.shots[0].plate).toBe("reference.plate-1.png");
    expect(spec.shots[1].plate).toBeUndefined();
    expect(specHtml(spec)).toContain("reference.plate-1.png");
  });
});

describe("cleanWords", () => {
  it("keeps words that follow each other at the same place, drops a misreading", () => {
    const five = word("5", 400, 0, { end: 0.5 });
    const six = word("6", 400, 0.45, { end: 1 });
    const misread = word("S", 400, 0.5, { end: 0.95, conf: 70 });
    expect(cleanWords([five, six, misread]).map((w) => w.text)).toEqual(["5", "6"]);
  });
});

describe("lookAlike", () => {
  const thumbs = (fill: number[]) => ({
    cols: 2,
    rows: 1,
    frames: [0.25, 0.5].map((t) => ({ t, rgb: btoa(String.fromCharCode(...fill, ...fill)) })),
  });
  it("is 1 for the same frames and caps the fidelity of frames unlike", () => {
    const ref = obs([], { thumbs: thumbs([200, 20, 20]), cuts: [] });
    expect(lookAlike(ref, ref, 0, 1)).toBe(1);
    const other = { ...ref, thumbs: thumbs([255, 255, 255]) };
    expect(lookAlike(ref, other, 0, 1)).toBe(0);
    const [m] = measureShots(specFromObservations(ref), ref, other);
    expect(fidelity(m)).toBe(0);
  });
});

describe("word colours", () => {
  it("keeps a word of another ink than the shot's", () => {
    const o = obs([
      word("viewlify", 197, 0.15, { color: "#ffffff" }),
      word("tools", 600, 0.15, { color: "#ffffff" }),
      word("All", 197, 0.3, { color: "#241912", box: { x: 197, y: 650, w: 120, h: 60 } }),
    ], { backgrounds: [{ t: 0, color: "#c0392b" }] });
    const shot = specFromObservations(o).shots[0];
    const words = shot.kind === "text" ? shot.lines.flatMap((l) => l.words) : [];
    expect(words.find((w) => w.text === "All")?.color).toBe("#241912");
    expect(words.find((w) => w.text === "tools")?.color).toBeUndefined();
  });
});

describe("counters", () => {
  it("makes a number that counts up in place from the smaller ones caught before", () => {
    const at = (text: string, start: number, extra: Partial<ObservedWord> = {}) =>
      word(text, 400, start, { box: { x: 400, y: 200, w: 300, h: 200 }, ...extra });
    const fourteen = at("14", 0.9, { seen: 8, end: 4 });
    const o = obs([at("10", 0.6, { seen: 1, conf: 97, end: 0.8 }), at("13", 0.8, { seen: 1, conf: 95, end: 0.9 }), fourteen]);
    const count = counterOf(o, fourteen, 0);
    expect(count).toBeDefined();
    expect(count?.end).toBe(0.9);
    expect(count?.start).toBeLessThan(0.6);
    expect(labelsFor(o, [fourteen])[0].count).toEqual(count);
    expect(counterOf(o, word("tools", 400, 1), 0)).toBeUndefined();
  });
});

describe("label moves", () => {
  it("follows a word that grows, and stays still for one that does not", () => {
    const grows = word("14", 400, 0.9, {
      box: { x: 400, y: 200, w: 300, h: 200 },
      path: [
        { t: 1, x: 475, y: 250, w: 150, h: 100 },
        { t: 2, x: 437, y: 225, w: 225, h: 150 },
        { t: 3, x: 400, y: 200, w: 300, h: 200 },
      ],
    });
    const path = wordPath(grows, 1920, 1080);
    expect(path[0].scale).toBe(0.5);
    expect(path.at(-1)?.scale).toBe(1);
    const still = word("tools", 400, 1, { path: [{ t: 1, x: 400, y: 488, w: 300, h: 115 }, { t: 2, x: 401, y: 488, w: 300, h: 115 }] });
    expect(wordPath(still, 1920, 1080)).toEqual([]);
  });
});

describe("specToEdit", () => {
  it("turns a spec into editor layers that the editor accepts as they are", () => {
    const fourteen = word("14", 400, 0.9, { box: { x: 400, y: 200, w: 300, h: 200 }, seen: 8, end: 3 });
    const o = obs(
      [
        word("10", 400, 0.6, { box: { x: 400, y: 200, w: 300, h: 200 }, seen: 1, conf: 97, end: 0.8 }),
        fourteen,
        word("Chaque", 197, 0.15),
      ],
      {
        visuals: [visual(), visual({ kind: "clip", image: "reference.visual-2.webm", box: { x: 100, y: 800, w: 300, h: 100 } })],
        plates: [{ start: 0, end: 2, image: "reference.plate-1.png", seen: 1 }],
      },
    );
    const spec = specFromObservations(o);
    const asset = (file: string, kind: "image" | "video") => ({ id: file, name: file, kind, file, duration: null });
    const assets = new Map([
      ["reference.plate-1.png", asset("reference.plate-1.png", "image")],
      ["reference.visual-1.png", asset("reference.visual-1.png", "image")],
      ["reference.visual-2.webm", asset("reference.visual-2.webm", "video")],
    ]);
    const { edit, counters } = specToEdit(spec, assets);
    expect(edit.clips.every((c) => c.kind === "slide")).toBe(true);
    expect(edit.clips.reduce((s, c) => s + (c.kind === "slide" ? c.duration : 0), 0)).toBeCloseTo(spec.duration, 2);
    const kinds = new Set(edit.overlays.map((v) => v.kind));
    expect(kinds.has("image")).toBe(true);
    expect(kinds.has("text")).toBe(true);
    expect(counters.length).toBe(1);
    expect(counters[0].value).toBe(14);
    // The editor reads it back unchanged: nothing it does not know.
    const back = parseEditState(JSON.parse(JSON.stringify(edit)));
    expect(back?.overlays.length).toBe(edit.overlays.length);
    expect(back?.assets.length).toBe(edit.assets.length);
    expect(aspectOf(1920, 1080)).toBe("16:9");
    expect(aspectOf(1000, 700)).toBe("auto");
  });
});
