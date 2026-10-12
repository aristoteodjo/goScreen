import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidatesOrder,
  composeArgs,
  composeExt,
  extract,
  fillCode,
  fillRemembered,
  framesDue,
  framesFor,
  fromGlass,
  glassPoint,
  journal,
  needsCode,
  sceneEvent,
  videoSize,
  assetName,
  byteRange,
} from "./lib.mjs";

test("a constant-rate take holds one frame per tick of wall time", () => {
  assert.equal(framesDue(-1, 30), 0);
  assert.equal(framesDue(0, 30), 1);
  assert.equal(framesDue(1, 30), 31);
  assert.equal(framesDue(2.5, 30), 76);
});

test("video sides are even", () => {
  assert.deepEqual(videoSize(360, 780, 3), { width: 1080, height: 2340 });
  assert.deepEqual(videoSize(393, 852, 2.75), { width: 1080, height: 2344 });
});

test("taps land on the centre of the target, in glass units", () => {
  assert.deepEqual(
    glassPoint(
      { x: 80, y: 380, width: 200, height: 40 },
      { width: 360, height: 800 },
    ),
    { u: 0.5, v: 0.5 },
  );
});

test("scenes become chapters; a cut leaves a gap", () => {
  const chapters = [];
  let open = sceneEvent(chapters, null, {
    kind: "scene",
    at: 1,
    url: "a",
    caption: "One",
  });
  open = sceneEvent(chapters, open, { kind: "cut", at: 4 });
  open = sceneEvent(chapters, open, {
    kind: "scene",
    at: 6,
    url: "b",
    caption: "Two",
  });
  open = sceneEvent(chapters, open, { kind: "cut", at: 9 });
  assert.equal(open, null);
  assert.deepEqual(chapters, [
    { url: "a", start: 1, end: 4, caption: "One" },
    { url: "b", start: 6, end: 9, caption: "Two" },
  ]);
});

test("codes fill their placeholder only", () => {
  assert.equal(needsCode("{{ code }}"), true);
  assert.equal(needsCode("{{phone}}"), false);
  assert.equal(fillCode("a {{code}} b", "123456"), "a 123456 b");
});

test("the journal is a device take with one full-glass layer", () => {
  const j = journal({
    device: { id: "galaxy-s25", colorId: "navy", width: 360, height: 780 },
    size: { width: 1080, height: 2340 },
    pointers: [],
    chapters: [],
  });
  assert.equal(j.version, 3);
  assert.equal(j.mode, "device");
  assert.equal(j.layers[0].orientation, "portrait");
  assert.deepEqual(j.layers[0].rects, [
    { t: 0, x: 0, y: 0, width: 1, height: 1 },
  ]);
});

test("remembered values fill later steps; unknown ones fail loudly", () => {
  const memory = { order: "OD-1" };
  assert.equal(
    fillRemembered("/orders/{{order}}/{{code}}", memory),
    "/orders/OD-1/{{code}}",
  );
  assert.throws(() => fillRemembered("{{pickup}}", memory), /no value yet/);
});

test("remember keeps the first group, the match or the text", () => {
  assert.equal(
    extract("https://x.test/commandes/OD-AB12", "/commandes/([A-Z0-9-]+)"),
    "OD-AB12",
  );
  assert.equal(extract("Code : K7Q-9MX", "[A-Z0-9]{3}-[A-Z0-9]{3}"), "K7Q-9MX");
  assert.equal(extract("  plain \n", undefined), "plain");
  assert.throws(() => extract("abc", "\\d+"), /Nothing matches/);
});

test("glass points land in the visual viewport", () => {
  assert.deepEqual(
    fromGlass(0.5, 0.25, { x: 10, y: 100, width: 400, height: 800 }),
    { x: 210, y: 300 },
  );
});

test("targets prefer what a person reads over the page structure", () => {
  const order = candidatesOrder({
    role: { role: "button", name: "Pay" },
    text: "Pay",
    id: "#pay",
    css: "main > button",
  });
  assert.deepEqual(order, [
    { role: "button", name: "Pay" },
    { text: "Pay" },
    { css: "#pay" },
    { css: "main > button" },
  ]);
  assert.deepEqual(candidatesOrder({ testId: "x", css: "a" })[0], {
    testId: "x",
  });
});

test("compositions keep their transparency per platform", () => {
  const job = { fps: 30, out: "/o", transparent: true };
  assert.ok(composeArgs(job, "darwin").includes("hevc_videotoolbox"));
  assert.ok(composeArgs(job, "linux").includes("yuva420p"));
  assert.ok(
    composeArgs({ ...job, transparent: false }, "darwin").includes("libx264"),
  );
  assert.equal(composeExt(true, "darwin"), "mov");
  assert.equal(composeExt(true, "win32"), "webm");
  assert.equal(composeExt(false, "darwin"), "mp4");
  assert.equal(framesFor(2, 30), 60);
  assert.equal(framesFor(0, 30), 1);
});

test("assetName only lets plain picture and clip names through", () => {
  assert.equal(assetName("http://goscreen.assets/reference.visual-3.png"), "reference.visual-3.png");
  assert.equal(assetName("http://goscreen.assets/a%20b.png"), null);
  for (const bad of [
    "http://goscreen.assets/..%2Fspec.json",
    "http://goscreen.assets/%2Fetc%2Fpasswd.png",
    "http://goscreen.assets/.hidden.png",
    "http://goscreen.assets/spec.json",
    "http://example.com/x.png",
    "http://goscreen.assets/%E0%A4%A.png",
  ])
    assert.equal(assetName(bad), null, bad);
});

test("byteRange reads what a video element asks for", () => {
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(byteRange(undefined, 100), null);
  assert.equal(byteRange("bytes=200-", 100), null);
});
