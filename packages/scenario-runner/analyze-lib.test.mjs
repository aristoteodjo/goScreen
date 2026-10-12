import assert from "node:assert/strict";
import { test } from "node:test";
import {
  background,
  cutsFrom,
  aroundColor,
  editDistance,
  isMark,
  isMasked,
  isReliable,
  parseTsv,
  ppmReader,
  presence,
  rules,
  timing,
  trackVisuals,
  trackWords,
  unionBox,
  visualsOf,
} from "./analyze-lib.mjs";

const image = (w, h, fill) => {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set(fill, i * 3);
  return rgb;
};

test("ppmReader splits images across chunks", () => {
  const one = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([1, 2, 3, 4, 5, 6])]);
  const r = ppmReader();
  const both = Buffer.concat([one, one]);
  assert.equal(r.push(both.subarray(0, 15)).length, 0);
  const out = r.push(both.subarray(15));
  assert.equal(out.length, 2);
  assert.deepEqual([...out[1].rgb], [1, 2, 3, 4, 5, 6]);
});

test("parseTsv keeps confident words", () => {
  const tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
    "5\t1\t1\t1\t1\t1\t196\t512\t139\t92\t95.6\tde\n5\t1\t1\t1\t1\t2\t10\t10\t5\t5\t30\tzz\n5\t1\t1\t1\t1\t3\t1\t1\t5\t5\t90\t—\n";
  assert.deepEqual(parseTsv(tsv), [{ text: "de", conf: 96, x: 196, y: 512, w: 139, h: 92 }]);
});

test("background is the colour of the border", () => {
  const rgb = image(10, 10, [255, 255, 255]);
  rgb.set([0, 0, 0], (5 * 10 + 5) * 3);
  assert.deepEqual(background(rgb, 10, 10), [255, 255, 255]);
});

test("rules finds a thin coloured line, not a filled block", () => {
  const w = 100, h = 100;
  const rgb = image(w, h, [255, 255, 255]);
  for (let x = 10; x < 60; x++) for (const y of [50, 51]) rgb.set([27, 77, 255], (y * w + x) * 3);
  for (let x = 10; x < 60; x++) for (let y = 70; y < 90; y++) rgb.set([27, 77, 255], (y * w + x) * 3);
  assert.deepEqual(rules(rgb, w, h), [{ x: 10, y: 50, w: 50, h: 2, color: "#1b4dff" }]);
});

test("cutsFrom finds a sudden change", () => {
  assert.deepEqual(cutsFrom([0, 1, 2, 90, 1, 1], 20), [0.15]);
});

test("editDistance", () => {
  assert.equal(editDistance("chaque", "chaquc"), 1);
});

test("trackWords follows a word across samples and votes its text", () => {
  const w = (text, conf) => ({ text, conf, x: 100, y: 100, w: 200, h: 80 });
  const tracks = trackWords([
    { t: 0, words: [w("Chaquc", 70)] },
    { t: 0.25, words: [w("Chaque", 96)] },
    { t: 0.5, words: [w("Chaque", 95)] },
    { t: 3, words: [w("Chaque", 95)] },
  ]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].text, "Chaque");
  assert.equal(tracks[0].seen, 3);
});

test("presence is 1 for the same patch and 0 for the background", () => {
  const ref = Uint8Array.from([0, 255, 0, 255]);
  assert.equal(presence(ref, ref, 255), 1);
  assert.equal(presence(Uint8Array.from([255, 255, 255, 255]), ref, 255), 0);
});

test("timing reads in, settled and out, within bounds", () => {
  const curve = [0, 0, 0.2, 0.6, 0.9, 1, 1, 1, 0.3, 0];
  assert.deepEqual(timing(curve, 10, 6), { start: 0.2, settled: 0.4, end: 0.8 });
  assert.deepEqual(timing(curve, 10, 6, { from: 3 }), { start: 0.3, settled: 0.4, end: 0.8 });
});

test("visualsOf finds a picture and leaves big words out", () => {
  const w = 480, h = 270;
  const rgb = image(w, h, [255, 255, 255]);
  const fill = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.set(c, (y * w + x) * 3);
  };
  fill(40, 40, 120, 100, [20, 30, 200]); // a logo
  fill(300, 150, 400, 180, [0, 0, 0]); // a big word, read by OCR
  const found = visualsOf(rgb, w, h, [255, 255, 255], [{ x: 295, y: 145, w: 110, h: 40 }]);
  assert.equal(found.length, 1);
  const [v] = found;
  assert.ok(v.x <= 40 && v.y <= 40 && v.x + v.w >= 120 && v.y + v.h >= 100);
  assert.ok(v.w < 100 && v.h < 80);
});

test("trackVisuals follows a moving picture and tells a clip by its changes", () => {
  const thumb = (g) => new Array(64).fill(g);
  const still = [0, 0.25, 0.5].map((t, i) => ({
    t,
    visuals: [{ x: 100 + i * 10, y: 100, w: 200, h: 100, thumb: thumb(40) }],
  }));
  const [k] = trackVisuals(still);
  assert.equal(k.path.length, 3);
  assert.equal(k.changes, 0);
  assert.deepEqual(unionBox(k.path), { x: 100, y: 100, w: 220, h: 100 });
  const anim = still.map((s, i) => ({ ...s, visuals: [{ ...s.visuals[0], thumb: thumb(40 + i * 20) }] }));
  assert.ok(trackVisuals(anim)[0].changes >= 20);
  // Somewhere else entirely: another element.
  const apart = [still[0], { t: 0.25, visuals: [{ x: 900, y: 600, w: 200, h: 100, thumb: thumb(40) }] }];
  assert.equal(trackVisuals(apart).length, 2);
});

test("a spread-out wordmark is a picture, a word of text is masked", () => {
  assert.equal(isMark({ text: "REMAIN", w: 699, h: 83 }), true);
  assert.equal(isMark({ text: "REPORTING", w: 560, h: 70 }), false);
  assert.equal(isMark({ text: "minutes,", w: 446, h: 101 }), false);
  assert.equal(isMasked({ text: "minutes,", w: 446, h: 101 }, 1080), true);
  assert.equal(isMasked({ text: "REMAIN", w: 699, h: 83 }, 1080), false);
  assert.equal(isMasked({ text: "AUDIT", w: 69, h: 19 }, 1080), false);
});

test("aroundColor reads the colour just around a word (a card's)", () => {
  const w = 100, h = 60;
  const rgb = image(w, h, [245, 246, 251]);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 90; x++) rgb.set([255, 255, 255], (y * w + x) * 3);
  assert.deepEqual(aroundColor(rgb, w, h, { x: 30, y: 20, w: 40, h: 15 }), [255, 255, 255]);
});

test("a word's colour is its sharpest reading, not one blurred coming in or leaving", () => {
  const w = (t, color) => ({ text: "qui", conf: 95, x: 100, y: 100, w: 200, h: 80, color, t });
  const [k] = trackWords([
    { t: 0, words: [w(0, "#737478")] },
    { t: 0.25, words: [w(0.25, "#0c0c15")] },
    { t: 0.5, words: [w(0.5, "#1c1d25")] },
  ]);
  assert.equal(k.color, "#0c0c15");
});

test("an element that something appears around is still there", () => {
  const thumb = new Array(64).fill(200);
  const letter = { x: 100, y: 100, w: 40, h: 50, thumb };
  const [k] = trackVisuals([
    { t: 0, visuals: [letter] },
    { t: 0.25, visuals: [letter] },
    // A glow behind it: one bigger piece.
    { t: 0.5, visuals: [{ x: 60, y: 60, w: 200, h: 150, thumb: new Array(64).fill(90) }] },
  ]);
  assert.equal(k.last, 0.5);
  assert.deepEqual(k.path.at(-1), { t: 0.5, x: 100, y: 100, w: 40, h: 50 });
});

test("only a reliable reading is left out of the pictures", () => {
  assert.equal(isReliable({ text: "ll", seen: 1, conf: 57, start: 5.6, end: 6.4 }), false);
  assert.equal(isReliable({ text: "temps", seen: 3, conf: 97, start: 5.7, end: 6.4 }), true);
});

test("a picture's reference is its most usual look at rest, not a frame coming in", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };
  const look = (g, t) => ({ t, background: "#ffffff", visuals: [{ ...box, thumb: new Array(64).fill(g) }] });
  // Fading in (230, 215), then as it is (190) for a while.
  const [k] = trackVisuals([look(230, 0), look(215, 0.25), look(190, 0.5), look(191, 0.75), look(190, 1)]);
  assert.ok(k.best >= 0.5);
});

test("an element is held for one sample only", () => {
  const thumb = new Array(64).fill(200);
  const dot = { x: 100, y: 100, w: 30, h: 30, thumb };
  const blob = { x: 80, y: 80, w: 80, h: 100, thumb: new Array(64).fill(90) };
  const [k] = trackVisuals([
    { t: 0, visuals: [dot] },
    { t: 0.25, visuals: [dot] },
    { t: 0.5, visuals: [blob] },
    { t: 0.75, visuals: [blob] },
  ]);
  assert.equal(k.last, 0.5);
});
