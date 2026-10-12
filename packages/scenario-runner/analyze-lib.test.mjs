import assert from "node:assert/strict";
import { test } from "node:test";
import {
  background,
  cutsFrom,
  editDistance,
  parseTsv,
  ppmReader,
  presence,
  rules,
  timing,
  trackWords,
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
