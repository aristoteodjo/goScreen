// End to end: the built-in scenes (@goscreen/blocks SCENES) render through
// the composer, draw something at t, and a screen scene shows a montage
// asset served by name (http://goscreen.assets/<file>).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const compose = new URL("./compose.mjs", import.meta.url).pathname;
const blocks = new URL("../blocks/src/index.ts", import.meta.url).pathname;

/** The composer's page for a scene: made by the real prepareCompositionHtml (TypeScript, stripped by Node). */
function pageOf(id, props, size) {
  const code = `import { prepareCompositionHtml, sceneFor } from ${JSON.stringify(blocks)};
const c = sceneFor(${JSON.stringify(id)}, "16:9");
process.stdout.write(JSON.stringify({ html: prepareCompositionHtml(c, ${JSON.stringify(props)}, ${JSON.stringify(size)}), transparent: c.transparent, duration: c.duration }));`;
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--input-type=module",
      "-e",
      code,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// A still of a transparent page is composed on this colour (the composer's
// `background`): what differs from it is what the scene drew.
const BG = [18, 52, 86];
const onBg = (r, g, b) =>
  Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]) < 24;

function still(dir, id, t, props = {}, assets) {
  const size = { width: 320, height: 180 };
  const page = pageOf(id, props, size);
  const out = join(dir, `${id}-${t}.png`);
  const job = {
    ...size,
    ...page,
    fps: 30,
    frame: t,
    format: "png",
    out,
    ffmpeg: "",
    assets,
    background: "#123456",
  };
  const file = join(dir, "job.json");
  writeFileSync(file, JSON.stringify(job));
  const r = spawnSync(process.execPath, [compose, file], { encoding: "utf8" });
  const last = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .at(-1);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(last?.type, "done", JSON.stringify(last));
  return decodePng(readFileSync(out));
}

/** An 8-bit RGB/RGBA PNG as { width, height, channels, pixels } (filters undone). */
function decodePng(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colour = png[25];
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : null;
  assert.ok(channels, `colour type ${colour}`);
  const idat = [];
  let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c =
        x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      pixels[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, pixels };
}

/** A solid-colour RGBA PNG: the test's "screenshot" asset. */
function solidPng(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++)
      rows.set([r, g, b, 255], y * (width * 4 + 1) + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const count = (img, keep) => {
  let n = 0;
  for (let i = 0; i < img.pixels.length; i += img.channels)
    if (keep(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2])) n++;
  return n;
};
const colours = (img) => {
  const seen = new Set();
  for (let i = 0; i < img.pixels.length; i += img.channels)
    seen.add(
      (img.pixels[i] << 16) | (img.pixels[i + 1] << 8) | img.pixels[i + 2],
    );
  return seen.size;
};

test("scenes draw something at t: a plate, a counter, a cursor", () => {
  const dir = mkdtempSync(join(tmpdir(), "goscreen-scenes-"));
  // The opaque plate: a dark gradient with a beam, far from a flat colour.
  const plate = still(dir, "glow-stage", 3);
  assert.equal(plate.channels, 3);
  assert.ok(colours(plate) > 200, `plate colours: ${colours(plate)}`);
  assert.ok(
    count(plate, (r, g, b) => r + g + b < 200) >
      plate.width * plate.height * 0.3,
    "mostly dark",
  );
  // Transparent scenes: ink where they draw, the background elsewhere.
  const counter = still(dir, "kinetic-counter", 3, { from: 10, to: 90 });
  const inked = count(counter, (r, g, b) => r > 200 && g > 200 && b > 200);
  assert.ok(inked > 300, `counter ink pixels: ${inked}`);
  assert.ok(
    count(counter, onBg) > counter.width * counter.height * 0.5,
    "mostly clear",
  );
  const cursor = still(dir, "cursor-click", 1.25, { accent: "#ff0000" });
  const ring = count(cursor, (r, g, b) => r > 120 && g < 90 && b < 110);
  assert.ok(ring > 20, `click ring pixels: ${ring}`);
  assert.ok(
    count(cursor, onBg) > cursor.width * cursor.height * 0.9,
    "a cursor only",
  );
});

test("a screen scene shows a montage asset by name, a mock interface without it", () => {
  const dir = mkdtempSync(join(tmpdir(), "goscreen-scenes-"));
  const assets = join(dir, "take.assets");
  mkdirSync(assets);
  writeFileSync(join(assets, "shot.png"), solidPng(64, 40, [255, 0, 170]));
  const magenta = (img) =>
    count(img, (r, g, b) => r > 200 && g < 60 && b > 120);
  const withAsset = still(dir, "device-3d", 4, { screen: "shot.png" }, assets);
  assert.ok(magenta(withAsset) > 2000, `screen pixels: ${magenta(withAsset)}`);
  const without = still(dir, "device-3d", 4, { screen: "shot.png" });
  assert.equal(magenta(without), 0);
  assert.ok(
    count(without, (r, g, b) => !onBg(r, g, b)) > 2000,
    "the mock interface is drawn",
  );
});
