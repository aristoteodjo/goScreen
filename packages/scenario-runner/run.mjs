#!/usr/bin/env node
// Plays a scenario in a headless browser and writes the take: a constant-rate
// MP4 of the screen (CDP screencast -> FFmpeg) and its interactions journal
// (taps in glass coordinates, scenes as captioned chapters).
//
// Usage: run.mjs <job.json>. Progress goes to stdout, one JSON per line.
// The job comes from goScreen (`scenario_run`): it is trusted, already
// validated by @goscreen/scenario, variables filled.

import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { serveLive } from "./live.mjs";
import {
  extract,
  fillCode,
  fillRemembered,
  framesDue,
  glassPoint,
  journal,
  needsCode,
  sceneEvent,
  videoSize,
} from "./lib.mjs";

const ACTION_TIMEOUT = 15_000;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { scenario, device } = job;
const fps = job.fps ?? 30;
// A simulation plays every step without filming: no screencast, no FFmpeg.
// Live: play the steps, then hand the page to the studio (no video).
const live = job.live === true;
const dry = job.dry === true || live;
const PREVIEW_EVERY_MS = 1500;
const size = videoSize(device.width, device.height, device.dpr);
const viewport = { width: device.width, height: device.height };

let cancelled = false;
let browser = null;

// Runs in every frame before the page's own scripts: blocks matching a mask
// are hidden before they are ever painted; their digits are kept as codes.
function maskInit(patterns) {
  if (!patterns.length) return;
  const rx = patterns.map((p) => new RegExp(p));
  const matches = (s) => rx.some((r) => r.test(s.trim()));
  const hide = (node) => {
    // The closest block (up to 5 levels) whose whole text matches: a label
    // and its code often sit in sibling elements of one paragraph.
    let el = node.parentElement;
    for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) return;
      if (matches(el.textContent || "")) break;
    }
    if (!el || el === document.body || !matches(el.textContent || "")) return;
    if (el.dataset.goscreenMask) return;
    el.dataset.goscreenMask = "1";
    el.style.setProperty("visibility", "hidden", "important");
    const codes = (el.textContent || "").match(/\d{4,8}/g) || [];
    window.__goscreenCodes = (window.__goscreenCodes || []).concat(codes);
  };
  const scan = (root) => {
    if (root.nodeType === Node.TEXT_NODE) return hide(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) hide(n);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") hide(r.target);
      else r.addedNodes.forEach(scan);
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
}

class Recorder {
  constructor() {
    this.latest = null;
    this.written = 0;
    this.pointers = [];
    this.chapters = [];
    this.open = null;
  }

  async attach(page) {
    if (this.cdp) {
      await this.cdp.send("Page.stopScreencast").catch(() => {});
      await this.cdp.detach().catch(() => {});
    }
    this.page = page;
    if (dry) return;
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on("Page.screencastFrame", (f) => {
      this.latest = Buffer.from(f.data, "base64");
      this.cdp
        .send("Page.screencastFrameAck", { sessionId: f.sessionId })
        .catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 88,
      maxWidth: size.width,
      maxHeight: size.height,
      everyNthFrame: 1,
    });
  }

  async start() {
    this.t0 = performance.now();
    this.previews = setInterval(() => this.preview(), PREVIEW_EVERY_MS);
    if (dry) return;
    const end = Date.now() + 10_000;
    while (!this.latest && Date.now() < end) await sleep(50);
    if (!this.latest) throw new Error("The browser sent no picture.");
    this.ffmpeg = spawn(
      job.ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        String(fps),
        "-c:v",
        "mjpeg",
        "-i",
        "-",
        "-vf",
        `scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "16",
        "-r",
        String(fps),
        "-movflags",
        "+faststart",
        job.video,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.ffmpegLog = "";
    this.ffmpeg.stderr.on("data", (d) => {
      this.ffmpegLog = (this.ffmpegLog + d).slice(-2000);
    });
    this.ffmpeg.stdin.on("error", () => {});
    this.t0 = performance.now();
    // A still screen sends no frames: the last picture is repeated, so the
    // video keeps wall-clock time and every scene lasts what it lasted.
    this.ticker = setInterval(() => this.tick(), 1000 / fps / 2);
  }

  now() {
    return (performance.now() - this.t0) / 1000;
  }

  tick() {
    const due = framesDue(this.now(), fps);
    while (this.written < due) {
      this.ffmpeg.stdin.write(this.latest);
      this.written += 1;
    }
  }

  tap(u, v) {
    const t = this.now();
    const at = {
      x: u,
      y: v,
      u,
      v,
      instanceId: "scenario-glass",
      source: "web",
    };
    this.pointers.push(
      { t: Math.max(0, t - 0.35), kind: "move", ...at },
      { t, kind: "down", ...at },
      { t: t + 0.08, kind: "up", ...at },
    );
  }

  scene(kind, caption) {
    this.open = sceneEvent(this.chapters, this.open, {
      kind,
      at: this.now(),
      url: this.page.url(),
      caption,
    });
  }

  // A small picture of the page now, for the studio's task panel.
  async preview() {
    if (this.previewing || !this.page) return;
    this.previewing = true;
    try {
      const jpeg = await this.page.screenshot({
        type: "jpeg",
        quality: 55,
        scale: "css",
        timeout: 3000,
      });
      emit({ type: "preview", jpeg: jpeg.toString("base64") });
    } catch {
      // The page is navigating: the next tick will catch it.
    } finally {
      this.previewing = false;
    }
  }

  async stop() {
    clearInterval(this.ticker);
    clearInterval(this.previews);
    if (dry) return this.now();
    if (!this.ffmpeg) return 0;
    this.scene("cut");
    this.tick();
    const duration = this.now();
    this.ffmpeg.stdin.end();
    const code = await new Promise((r) => this.ffmpeg.on("close", r));
    if (code !== 0) throw new Error(`FFmpeg failed: ${this.ffmpegLog.trim()}`);
    return duration;
  }
}

async function launch() {
  const options = { headless: true };
  if (job.browser)
    return chromium.launch({ ...options, executablePath: job.browser });
  try {
    return await chromium.launch({ ...options, channel: "chrome" });
  } catch {
    try {
      return await chromium.launch(options);
    } catch {
      throw new Error(
        "No browser found: install Google Chrome, or run `npx playwright install chromium`.",
      );
    }
  }
}

const sessions = new Map();

async function session(name) {
  if (sessions.has(name)) return sessions.get(name);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: device.dpr,
    isMobile: device.mobile,
    hasTouch: device.touch,
    userAgent: device.userAgent,
    locale: scenario.locale,
    ...(scenario.timezone ? { timezoneId: scenario.timezone } : {}),
    colorScheme: scenario.colorScheme,
  });
  await context.addInitScript(maskInit, scenario.mask);
  // Whatever a page or a link asks for, only web requests leave the browser.
  await context.route(
    (url) => !/^(https?|data|blob):$/.test(url.protocol),
    (route) => route.abort("blockedbyclient"),
  );
  context.setDefaultTimeout(ACTION_TIMEOUT);
  const page = await context.newPage();
  sessions.set(name, page);
  return page;
}

const TARGET_TEXTS = [
  "css",
  "text",
  "name",
  "label",
  "placeholder",
  "testId",
  "frame",
  "hasText",
];

function locate(page, target) {
  // Values remembered earlier in the run ({{order}}) fill selectors too.
  const t = { ...target };
  for (const key of TARGET_TEXTS)
    if (typeof t[key] === "string") t[key] = fillRemembered(t[key], memory);
  const root = t.frame ? page.frameLocator(t.frame) : page;
  const exact = t.exact;
  const loc =
    t.css !== undefined
      ? root.locator(t.css)
      : t.text !== undefined
        ? root.getByText(t.text, { exact })
        : t.role !== undefined
          ? root.getByRole(t.role, { name: t.name, exact })
          : t.label !== undefined
            ? root.getByLabel(t.label, { exact })
            : t.placeholder !== undefined
              ? root.getByPlaceholder(t.placeholder, { exact })
              : root.getByTestId(t.testId);
  const filtered = t.hasText ? loc.filter({ hasText: t.hasText }) : loc;
  if (t.nth === -1) return filtered.last();
  return t.nth !== undefined ? filtered.nth(t.nth) : filtered.first();
}

async function codes(page) {
  const all = await Promise.all(
    page
      .frames()
      .map((f) =>
        f.evaluate(() => window.__goscreenCodes || []).catch(() => []),
      ),
  );
  return all.flat();
}

async function waitCode(page) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const found = await codes(page);
    if (found.length) return found.at(-1);
    await sleep(300);
  }
  throw new Error("No code appeared in a masked block within 30 s.");
}

async function clearCodes(page) {
  await Promise.all(
    page.frames().map((f) =>
      f
        .evaluate(() => {
          window.__goscreenCodes = [];
        })
        .catch(() => {}),
    ),
  );
}

async function smoothScroll(page, dy, ms) {
  const steps = Math.max(1, Math.round(ms / 30));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(30);
  }
}

async function tap(rec, loc) {
  await loc.waitFor({ state: "visible" });
  await loc.scrollIntoViewIfNeeded();
  await sleep(250);
  const box = await loc.boundingBox();
  if (box) {
    // Boxes are in layout pixels; the glass shows the visual viewport (a
    // page without a mobile viewport is laid out wider, then zoomed out).
    const vv = await rec.page.evaluate(() => {
      const v = window.visualViewport;
      return v
        ? { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height }
        : { x: 0, y: 0, width: innerWidth, height: innerHeight };
    });
    const { u, v } = glassPoint(
      { ...box, x: box.x - vv.x, y: box.y - vv.y },
      vv,
    );
    rec.tap(u, v);
  }
  await loc.click();
}

const memory = {};

// {{code}} waits for a masked code; remembered names are filled as they are.
async function fill(page, text) {
  let out = fillRemembered(text, memory);
  if (needsCode(out)) {
    out = fillCode(out, await waitCode(page));
    await clearCodes(page);
  }
  return out;
}

async function open(page, url) {
  if (!/^https?:\/\//i.test(url))
    throw new Error(`Refused to open ${url}: only http(s).`);
  await page.goto(url, { waitUntil: "load", timeout: 45_000 });
  // Single-page apps keep loading data after `load`.
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
}

async function play(rec, step) {
  const page = rec.page;
  switch (step.do) {
    case "goto":
      await open(page, fillRemembered(step.url, memory));
      return;
    case "scene":
      rec.scene("scene", step.caption);
      emit({ type: "scene", caption: step.caption });
      return;
    case "cut":
      rec.scene("cut");
      return;
    case "tap": {
      const loc = locate(page, step.target);
      for (let i = 0; i < (step.repeat ?? 1); i++) {
        await tap(rec, loc);
        if (step.repeat) await sleep(180);
      }
      return;
    }
    case "type": {
      const text = await fill(page, step.text);
      const delay = step.delay ?? 70;
      if (!step.target) {
        await page.keyboard.type(text, { delay });
        return;
      }
      const loc = locate(page, step.target);
      await tap(rec, loc);
      if (step.clear) await loc.fill("");
      await loc.pressSequentially(text, { delay });
      return;
    }
    case "check": {
      const loc = locate(page, step.target);
      if ((await loc.isChecked()) !== step.value) await tap(rec, loc);
      if ((await loc.isChecked()) !== step.value)
        await loc.setChecked(step.value, { force: true });
      return;
    }
    case "remember": {
      const source = step.target
        ? await locate(page, step.target).innerText()
        : page.url();
      memory[step.name] = extract(source, step.match);
      return;
    }
    case "press":
      await page.keyboard.press(step.key);
      return;
    case "scroll": {
      const ms = step.duration ?? 900;
      if (step.by !== undefined) return smoothScroll(page, step.by, ms);
      const loc = locate(page, step.to);
      await loc.waitFor({ state: "attached" });
      const box = await loc.boundingBox();
      if (box) await smoothScroll(page, box.y - viewport.height * 0.3, ms);
      return;
    }
    case "wait":
      await sleep(step.ms);
      return;
    case "waitFor":
      await locate(page, step.target).waitFor({
        state: "visible",
        timeout: step.timeout ?? 20_000,
      });
      return;
    case "waitUrl":
      await page.waitForURL(new RegExp(step.match), {
        timeout: step.timeout ?? 30_000,
      });
      return;
    case "session": {
      const next = await session(step.name);
      if (next !== page) await rec.attach(next);
      return;
    }
  }
}

process.on("SIGTERM", () => {
  cancelled = true;
  browser?.close().catch(() => {});
});

async function main() {
  const rec = new Recorder();
  let index = -1;
  try {
    browser = await launch();
    const page = await session("main");
    // The first page loads before the camera rolls.
    await open(page, scenario.url);
    await rec.attach(page);
    await rec.start();
    const total = scenario.steps.length;
    for (index = 0; index < total; index++) {
      if (cancelled) throw new Error("Cancelled.");
      emit({ type: "step", index, total });
      try {
        await play(rec, scenario.steps[index]);
      } catch (e) {
        if (!live) throw e;
        // Live: stop replaying and let the user fix it on the page.
        emit({
          type: "warn",
          index,
          message: `Replay stopped at step ${index + 1}: ${String(e?.message ?? e).split("\n")[0]}`,
        });
        break;
      }
    }
    if (live) {
      await rec.stop();
      await serveLive({
        emit,
        viewport,
        page: () => rec.page,
        locate,
        fill,
        open,
        play: (step) => play(rec, step),
      });
      emit({ type: "done", duration: 0 });
      // stdin would keep the process alive once the studio is done.
      process.stdin.destroy();
      return;
    }
    await sleep(400);
    await rec.preview();
    const duration = await rec.stop();
    if (dry) {
      emit({ type: "done", duration });
      return;
    }
    writeFileSync(
      job.interactions,
      JSON.stringify(
        journal({
          device,
          size,
          pointers: rec.pointers,
          chapters: rec.chapters,
        }),
        null,
        1,
      ),
    );
    emit({ type: "done", duration });
  } catch (e) {
    let shot = null;
    if (rec.page && !cancelled) {
      shot = await rec.page
        .screenshot({ path: job.failShot })
        .then(() => job.failShot)
        .catch(() => null);
    }
    await rec.stop().catch(() => {});
    if (!dry) rmSync(job.video, { force: true });
    emit({
      type: "error",
      index: index >= 0 ? index : null,
      message: cancelled
        ? "Cancelled."
        : String(e?.message ?? e).split("\n")[0],
      shot,
    });
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
}

main();
