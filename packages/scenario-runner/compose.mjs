#!/usr/bin/env node
// Renders an HTML composition (a goScreen block) to a video, frame by frame:
// every CSS/WAAPI animation is paused and set to the frame's time, so the
// result is exact and the same on every run (the HyperFrames way).
//
// Usage: compose.mjs <job.json> with { html, width, height, fps, duration,
// transparent, out, ffmpeg, assets? }. With `assets` (a folder), the page may
// load the pictures and clips of that folder, by name only, from
// http://goscreen.assets/<name>; nothing else. Progress on stdout, one JSON per line.
// With `frame` (seconds), a single still is written to `out` instead (JPEG,
// or PNG with `format`; on `background` when the page is transparent): a
// look without a render.

import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { assetName, byteRange, composeArgs, framesFor } from "./lib.mjs";

const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

// Runs in the page: every animation at `t` seconds; a page may also listen
// (and return a promise: its clips are sought before the screenshot).
function seek(t) {
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = t * 1000;
  }
  return window.__goscreenSeek?.(t);
}

const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", webm: "video/webm", mp4: "video/mp4" };

async function main() {
  const browser = await launch();
  let ffmpeg = null;
  try {
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    // Only the composition: no network (blocks are self-contained), except
    // the files of `assets`, by name.
    await page.route("**/*", (route) => {
      const name = job.assets ? assetName(route.request().url()) : null;
      if (!name) return route.abort();
      let body;
      try {
        body = readFileSync(join(job.assets, name));
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
      const contentType = TYPES[name.split(".").pop().toLowerCase()];
      // A clip is sought frame by frame: Chrome asks for byte ranges.
      const range = byteRange(route.request().headers().range, body.length);
      if (!range) return route.fulfill({ status: 200, body, contentType, headers: { "Accept-Ranges": "bytes" } });
      return route.fulfill({
        status: 206,
        body: body.subarray(range.start, range.end + 1),
        contentType,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${range.start}-${range.end}/${body.length}`,
        },
      });
    });
    await page.setContent(job.html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    // A page that builds its animations from script says when it is done.
    await page.evaluate(() => window.__goscreenReady);
    if (typeof job.frame === "number") {
      await page.evaluate(seek, job.frame);
      if (job.transparent)
        await page.evaluate((bg) => {
          document.documentElement.style.backgroundColor = bg;
        }, job.background || "#808080");
      const still =
        job.format === "png"
          ? await page.screenshot({ type: "png" })
          : await page.screenshot({ type: "jpeg", quality: 90 });
      writeFileSync(job.out, still);
      emit({ type: "done", file: job.out, frames: 1 });
      return;
    }
    const frames = framesFor(job.duration, job.fps);
    ffmpeg = spawn(job.ffmpeg, composeArgs(job), {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let log = "";
    ffmpeg.stderr.on("data", (d) => {
      log = (log + d).slice(-2000);
    });
    ffmpeg.stdin.on("error", () => {});
    for (let i = 0; i < frames; i++) {
      await page.evaluate(seek, i / job.fps);
      const png = await page.screenshot({
        type: "png",
        omitBackground: job.transparent,
      });
      if (!ffmpeg.stdin.write(png))
        await new Promise((r) => ffmpeg.stdin.once("drain", r));
      if (i % 10 === 0) emit({ type: "progress", done: i, total: frames });
    }
    ffmpeg.stdin.end();
    const code = await new Promise((r) => ffmpeg.on("close", r));
    if (code !== 0)
      throw new Error(`FFmpeg failed: ${log.trim().split("\n").at(-1)}`);
    emit({ type: "done", file: job.out, frames });
  } catch (e) {
    ffmpeg?.kill("SIGKILL");
    rmSync(job.out, { force: true });
    emit({ type: "error", message: String(e?.message ?? e).split("\n")[0] });
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
