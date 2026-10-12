#!/usr/bin/env node
// Measures a reference video so goScreen can rebuild it: hard cuts, the
// background, every word with its place, colour and timing (when it comes
// in, settles and leaves), and the coloured lines (underlines, strikes).
// Facts only: turning them into a motion spec is @goscreen/motion's job.
//
// Usage: analyze.mjs <job.json> with { video, ffmpeg, tesseract, out,
// ocrFps?, timeFps?, lang?, tessdata?, crops? }. With `crops`, every visual
// element (not a word) is also cut out next to `out`, as `<stem>.visual-N.png`
// (still) or `.webm` (animated inside). Progress on stdout, one JSON per line.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  background,
  cutsFrom,
  frameDiff,
  hex,
  inkColor,
  parseTsv,
  patchOf,
  ppmReader,
  presence,
  rules,
  timing,
  trackVisuals,
  trackWords,
  unionBox,
  visualsOf,
} from "./analyze-lib.mjs";

const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OCR_FPS = job.ocrFps ?? 4;
const TIME_FPS = job.timeFps ?? 20;
const SMALL = { width: 320, height: 180 };
const MAX_SECONDS = 300;

function run(cmd, args, { env, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const out = [];
    let err = "";
    p.stdout.on("data", (d) => (onStdout ? onStdout(d, p) : out.push(d)));
    p.stderr.on("data", (d) => {
      err = (err + d).slice(-2000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`${cmd.split("/").pop()} failed: ${err.trim().split("\n").at(-1)}`)),
    );
  });
}

async function probe() {
  const ffprobe = job.ffprobe ?? join(dirname(job.ffmpeg), "ffprobe");
  const out = await run(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json", job.video,
  ]);
  const j = JSON.parse(out.toString());
  const [n, d] = j.streams[0].r_frame_rate.split("/").map(Number);
  return {
    width: j.streams[0].width,
    height: j.streams[0].height,
    fps: Math.round((n / (d || 1)) * 1000) / 1000,
    duration: Number(j.format.duration),
  };
}

/** Small grey frames at TIME_FPS: they time every change. */
async function greyFrames() {
  const size = SMALL.width * SMALL.height;
  const frames = [];
  let rest = Buffer.alloc(0);
  await run(
    job.ffmpeg,
    [
      "-v", "error", "-t", String(MAX_SECONDS), "-i", job.video,
      "-vf", `fps=${TIME_FPS},scale=${SMALL.width}:${SMALL.height},format=gray`,
      "-f", "rawvideo", "-",
    ],
    {
      onStdout: (d) => {
        rest = rest.length ? Buffer.concat([rest, d]) : d;
        while (rest.length >= size) {
          frames.push(new Uint8Array(rest.subarray(0, size)));
          rest = rest.subarray(size);
        }
      },
    },
  );
  return frames;
}

/** Full-size colour frames at OCR_FPS, read by Tesseract a few at a time. */
async function ocrSamples(total) {
  const dir = mkdtempSync(join(tmpdir(), "goscreen-analyze-"));
  const samples = [];
  const pending = new Set();
  const limit = Math.max(1, availableParallelism() - 2);
  let index = 0;
  const reader = ppmReader();
  const read = async (frame, i) => {
    const t = Math.round((i / OCR_FPS) * 1000) / 1000;
    const file = join(dir, `${i}.ppm`);
    writeFileSync(file, frame.ppm);
    const args = [file, "stdout", "--psm", "11", "-l", job.lang ?? "eng"];
    if (job.tessdata) args.push("--tessdata-dir", job.tessdata);
    // A setting rather than the `tsv` config file, which a tessdata folder may not have.
    args.push("-c", "tessedit_create_tsv=1");
    const tsv = (await run(job.tesseract, args, { env: { OMP_THREAD_LIMIT: "1" } })).toString();
    rmSync(file, { force: true });
    const bg = background(frame.rgb, frame.width, frame.height);
    const words = parseTsv(tsv).map((w) => {
      const c = inkColor(frame.rgb, frame.width, w, bg);
      return { ...w, color: c ? hex(c) : null };
    });
    samples.push({
      t,
      background: hex(bg),
      words,
      rules: rules(frame.rgb, frame.width, frame.height),
      // Big words are drawn as text; everything else is a picture
      // (the same height as BIG_WORD in @goscreen/motion).
      visuals: visualsOf(
        frame.rgb,
        frame.width,
        frame.height,
        bg,
        words.filter((w) => w.h >= frame.height * 0.03),
      ),
    });
    emit({ type: "progress", step: "ocr", done: samples.length, total });
  };
  try {
    await run(
      job.ffmpeg,
      [
        "-v", "error", "-t", String(MAX_SECONDS), "-i", job.video,
        "-vf", `fps=${OCR_FPS}`, "-f", "image2pipe", "-vcodec", "ppm", "-",
      ],
      {
        onStdout: (d, proc) => {
          for (const frame of reader.push(d)) {
            const p = read(frame, index++).finally(() => {
              pending.delete(p);
              if (pending.size < limit) proc.stdout.resume();
            });
            pending.add(p);
          }
          // FFmpeg waits while Tesseract catches up.
          if (pending.size >= limit) proc.stdout.pause();
        },
      },
    );
    while (pending.size) await Promise.race(pending);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return samples.sort((a, b) => a.t - b.t);
}

const MAX_VISUALS = 160;

/** Presence over time of a box of the source, from the small grey frames. */
function presenceTiming(grey, info, box, settledAt, first, last, bgHex) {
  const sx = SMALL.width / info.width;
  const sy = SMALL.height / info.height;
  const small = {
    x: Math.max(0, Math.floor(box.x * sx)),
    y: Math.max(0, Math.floor(box.y * sy)),
    w: Math.max(1, Math.ceil(box.w * sx)),
    h: Math.max(1, Math.ceil(box.h * sy)),
  };
  small.w = Math.min(small.w, SMALL.width - small.x);
  small.h = Math.min(small.h, SMALL.height - small.y);
  const best = Math.min(grey.length - 1, Math.round(settledAt * TIME_FPS));
  const ref = patchOf(grey[best], SMALL.width, small);
  const c = bgHex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const bgGrey = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const curve = grey.map((f) => presence(patchOf(f, SMALL.width, small), ref, bgGrey));
  const from = Math.max(0, Math.floor((first - 1) * TIME_FPS));
  const to = Math.min(grey.length, Math.ceil((last + 1) * TIME_FPS));
  return timing(curve, TIME_FPS, best, { from, to });
}

/**
 * How much a track may change inside before it is replayed as a clip; a long
 * one (dark, low contrast) is a clip at the first sign of movement.
 */
const CLIP_CHANGES = 12;
const LONG_CLIP_CHANGES = 4;
const isClip = (k) =>
  k.path.length >= 3 &&
  (k.changes > CLIP_CHANGES || (k.path.length >= 2 * OCR_FPS && k.changes > LONG_CLIP_CHANGES));

/**
 * Visual elements followed across the samples, timed like the words. A still
 * one (a logo, a bullet) becomes an image that moves along its measured path;
 * one that animates inside (an interface) a clip of its area. With
 * `job.crops`, both are cut out of the video next to `out`.
 */
async function visualTracks(samples, grey, info) {
  const area = info.width * info.height;
  const tracks = trackVisuals(samples)
    // Seen once and small: noise, or a frame of a transition.
    .filter((k) => k.path.length >= 2 || k.box.w * k.box.h > area * 0.01)
    .sort((a, b) => (b.last - b.first + 0.25) * Math.sqrt(b.box.w * b.box.h) -
      (a.last - a.first + 0.25) * Math.sqrt(a.box.w * a.box.h))
    .slice(0, MAX_VISUALS)
    .sort((a, b) => a.first - b.first);
  const stem = basename(job.out).replace(/\.observations\.json$/, "").replace(/\.json$/, "");
  // A small margin keeps soft edges (shadows, antialiasing).
  const pad = (b, m = 4) => {
    const x = Math.max(0, b.x - m);
    const y = Math.max(0, b.y - m);
    // Even sizes: the clip encoder needs them.
    const w = Math.min(info.width - x, b.w + 2 * m) & ~1;
    const h = Math.min(info.height - y, b.h + 2 * m) & ~1;
    return { x, y, w, h };
  };
  const visuals = tracks.map((k, i) => {
    const sample = samples.find((s) => s.t === k.best);
    const t = presenceTiming(grey, info, k.box, k.best, k.first, k.last, sample?.background ?? "#ffffff");
    const clip = isClip(k);
    const start = Math.min(t.start, k.first);
    const end = Math.max(t.end, k.last + 0.5 / OCR_FPS);
    return {
      kind: clip ? "clip" : "image",
      image: job.crops ? `${stem}.visual-${i + 1}.${clip ? "webm" : "png"}` : null,
      // A clip holds every place the element goes; an image its picture at rest.
      box: pad(clip ? unionBox(k.path) : k.box),
      best: k.best,
      // Seen before its presence rose: it moved in rather than faded in.
      start,
      settled: Math.max(t.settled, start),
      end,
      changes: Math.round(k.changes * 10) / 10,
      path: k.path,
    };
  });
  if (job.crops) {
    // The pictures of an earlier analysis go: their numbers no longer match.
    for (const f of readdirSync(dirname(job.out)))
      if (f.startsWith(`${stem}.visual-`)) rmSync(join(dirname(job.out), f), { force: true });
    let done = 0;
    const queue = [...visuals];
    const limit = Math.max(1, availableParallelism() - 2);
    await Promise.all(
      Array.from({ length: limit }, async () => {
        for (let v = queue.shift(); v; v = queue.shift()) {
          const { x, y, w, h } = v.box;
          const crop = `crop=${w}:${h}:${x}:${y}`;
          const file = join(dirname(job.out), v.image);
          if (v.kind === "image")
            await run(job.ffmpeg, [
              "-v", "error", "-y", "-ss", String(v.best), "-i", job.video,
              "-frames:v", "1", "-vf", crop, file,
            ]);
          else
            // VP9: what every Chromium plays; a key frame every half second
            // so the renderer's seeks stay quick.
            await run(job.ffmpeg, [
              "-v", "error", "-y", "-ss", String(v.start), "-t", String(v.end - v.start),
              "-i", job.video, "-an", "-vf", crop,
              "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "28", "-deadline", "good",
              "-cpu-used", "4", "-row-mt", "1", "-g", "15", file,
            ]);
          emit({ type: "progress", step: "crops", done: ++done, total: visuals.length });
        }
      }),
    );
  }
  return visuals.map(({ best, ...v }) => v);
}

async function main() {
  try {
    const info = await probe();
    emit({ type: "progress", step: "frames", done: 0, total: 1 });
    const grey = await greyFrames();
    const diffs = grey.map((f, i) => (i ? frameDiff(grey[i - 1], f) : 0));
    const cuts = cutsFrom(diffs, TIME_FPS);
    const total = Math.ceil(Math.min(info.duration, MAX_SECONDS) * OCR_FPS);
    const samples = await ocrSamples(total);

    // Each word's presence over time, from the small grey frames.
    const sx = SMALL.width / info.width;
    const sy = SMALL.height / info.height;
    const words = trackWords(samples).map((track) => {
      const box = {
        x: Math.max(0, Math.floor(track.box.x * sx)),
        y: Math.max(0, Math.floor(track.box.y * sy)),
        w: Math.max(1, Math.ceil(track.box.w * sx)),
        h: Math.max(1, Math.ceil(track.box.h * sy)),
      };
      box.w = Math.min(box.w, SMALL.width - box.x);
      box.h = Math.min(box.h, SMALL.height - box.y);
      const best = Math.min(grey.length - 1, Math.round(track.settledAt * TIME_FPS));
      const ref = patchOf(grey[best], SMALL.width, box);
      const sample = samples.find((s) => s.t === track.settledAt);
      const bgGrey = sample
        ? (() => {
            const c = sample.background.match(/\w\w/g).map((h) => parseInt(h, 16));
            return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
          })()
        : 255;
      const curve = grey.map((f) => presence(patchOf(f, SMALL.width, box), ref, bgGrey));
      // Up to a second around the first and last readings (OCR samples are
      // 1 / OCR_FPS apart, entries and exits last well under a second).
      const from = Math.max(0, Math.floor((track.first - 1) * TIME_FPS));
      const to = Math.min(grey.length, Math.ceil((track.last + 1) * TIME_FPS));
      return { ...track, ...timing(curve, TIME_FPS, best, { from, to }) };
    });

    const visuals = await visualTracks(samples, grey, info);

    const out = {
      version: 1,
      source: job.video,
      ...info,
      timeFps: TIME_FPS,
      cuts,
      backgrounds: samples.map((s) => ({ t: s.t, color: s.background })),
      rules: samples.flatMap((s) => s.rules.map((r) => ({ t: s.t, ...r }))),
      words: words.sort((a, b) => a.start - b.start || a.box.x - b.box.x),
      visuals,
    };
    writeFileSync(job.out, JSON.stringify(out, null, 1));
    emit({ type: "done", file: job.out, words: out.words.length, cuts: cuts.length });
  } catch (e) {
    emit({ type: "error", message: String(e?.message ?? e).split("\n")[0] });
    process.exitCode = 1;
  }
}

main();
