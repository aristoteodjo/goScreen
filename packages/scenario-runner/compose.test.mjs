// End to end: the composer honours `__goscreenSeek` (what a composition's
// `setT` is wired to) before every capture, so a still at t shows t.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

// The page paints its red channel from the time it is shown: t = 1.5 s gives
// rgb(150, 0, 0). A `setT` page, wired the way goScreen's prelude does it.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%}</style></head><body>
<script>
window.__goscreenSeek = (t) => window.setT(t);
window.setT = (t) => { document.body.style.background = "rgb(" + Math.round(t * 100) + ",0,0)"; };
window.setT(0);
</script></body></html>`;

const compose = new URL("./compose.mjs", import.meta.url).pathname;
const base = {
  html: PAGE,
  width: 8,
  height: 8,
  fps: 10,
  duration: 1,
  transparent: false,
  ffmpeg: "ffmpeg",
};

const run = (job, dir) => {
  const file = join(dir, "job.json");
  writeFileSync(file, JSON.stringify(job));
  const out = spawnSync(process.execPath, [compose, file], {
    encoding: "utf8",
  });
  const events = out.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { code: out.status, last: events.at(-1), stderr: out.stderr };
};

/** The first pixel of a PNG (8-bit RGB/RGBA): raw whatever the row filter is. */
function firstPixel(png) {
  let at = 8;
  const idat = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3]];
}

const hasFfmpeg = () => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

test("a still at t is captured after the seek to t", () => {
  const dir = mkdtempSync(join(tmpdir(), "goscreen-compose-"));
  const png = join(dir, "still.png");
  const r = run({ ...base, frame: 1.5, out: png, format: "png" }, dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.last.type, "done");
  const [red, green] = firstPixel(readFileSync(png));
  assert.equal(red, 150);
  assert.equal(green, 0);
  const jpeg = join(dir, "still.jpg");
  assert.equal(run({ ...base, frame: 0.2, out: jpeg }, dir).code, 0);
  assert.ok(statSync(jpeg).size > 0);
});

test(
  "a clip renders every frame through FFmpeg",
  { skip: !hasFfmpeg() && "ffmpeg missing" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "goscreen-compose-"));
    const out = join(dir, "clip.mp4");
    const r = run({ ...base, out }, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.last.frames, 10);
    assert.ok(statSync(out).size > 0);
  },
);
