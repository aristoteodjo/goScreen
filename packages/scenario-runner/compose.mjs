#!/usr/bin/env node
// Renders an HTML composition (a goScreen block) to a video, frame by frame:
// every CSS/WAAPI animation is paused and set to the frame's time, so the
// result is exact and the same on every run (the HyperFrames way).
//
// Usage: compose.mjs <job.json> with { html, width, height, fps, duration,
// transparent, out, ffmpeg }. Progress on stdout, one JSON per line.

import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { composeArgs, framesFor } from "./lib.mjs";

const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

// Runs in the page: every animation at `t` seconds; a page may also listen.
function seek(t) {
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = t * 1000;
  }
  window.__goscreenSeek?.(t);
}

async function main() {
  const browser = await launch();
  let ffmpeg = null;
  try {
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    // Only the composition: no network (blocks are self-contained).
    await page.route("**/*", (route) => route.abort());
    await page.setContent(job.html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    // A page that builds its animations from script says when it is done.
    await page.evaluate(() => window.__goscreenReady);
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
