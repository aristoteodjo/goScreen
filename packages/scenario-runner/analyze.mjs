#!/usr/bin/env node
// Measures a reference video so goScreen can rebuild it: hard cuts, the
// background, every word with its place, colour and timing (when it comes
// in, settles and leaves), and the coloured lines (underlines, strikes).
// Facts only: turning them into a motion spec is @goscreen/motion's job.
//
// Frames are taken with `fps=N:round=up`: the frame shown at each time. The
// default rounding hands the last frame before the next slot, up to half a
// period later (a sample at 4.5 s showed the shot that starts at 4.6 s).
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
  frameThumb,
  hex,
  inkBox,
  inkColor,
  aroundColor,
  isMark,
  isMasked,
  isReliable,
  wordArea,
  parseTsv,
  makePlate,
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
      "-vf", `fps=${TIME_FPS}:round=up,scale=${SMALL.width}:${SMALL.height},format=gray`,
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
      // Its box on its letters (OCR's can be far larger for big glyphs).
      const box = c ? inkBox(frame.rgb, frame.width, w, c) : w;
      return { ...w, ...box, color: c ? hex(c) : null };
    });
    samples.push({
      t,
      background: hex(bg),
      words,
      rules: rules(frame.rgb, frame.width, frame.height),
      // How it looks, small: the rendering is compared with it.
      thumb: frameThumb(frame.rgb, frame.width, frame.height),
    });
    emit({ type: "progress", step: "ocr", done: samples.length, total });
  };
  try {
    await run(
      job.ffmpeg,
      [
        "-v", "error", "-t", String(MAX_SECONDS), "-i", job.video,
        "-vf", `fps=${OCR_FPS}:round=up`, "-f", "image2pipe", "-vcodec", "ppm", "-",
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
    // A clip carries its own way in and out: it starts a sample early so its
    // first frames are not lost (before, it shows the background).
    const start = Math.max(0, Math.min(t.start, k.first) - (clip ? 1 / OCR_FPS : 0));
    const end = Math.min(info.duration, Math.max(t.end, k.last + 0.5 / OCR_FPS) + (clip ? 1 / OCR_FPS : 0));
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
          const still = v.kind === "image";
          const file = join(dirname(job.out), v.image);
          if (still)
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

/**
 * Second pass over the frames, once the words are known: the pictures of
 * each sample, with every word the renderer draws left out for as long as it
 * is on screen, coming in included (blurred, OCR cannot read it yet, and it
 * rises from below).
 */
/** Writes raw RGB pixels as a PNG, through FFmpeg. */
function writePng(file, rgb, width, height) {
  return new Promise((resolve, reject) => {
    const p = spawn(job.ffmpeg, [
      "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`,
      "-i", "-", "-frames:v", "1", file,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (plate): ${err.trim()}`))));
    p.stdin.end(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength));
  });
}

/** Frames spread over a cut that its plate is the median of. */
const PLATE_FRAMES = 24;

/** The cut each sample belongs to (index into the bounds). */
const cutOf = (bounds, t) => Math.max(0, bounds.findIndex((b, j) => t >= b && t < (bounds[j + 1] ?? Infinity)));

/** The words drawn as text on screen at a sample: left out of plates and pictures. */
const wordsAt = (masked, t) => masked.filter((w) => t >= w.start - 0.4 && t <= w.end + 0.2);

/**
 * A pass over the frames for the plates: per cut, the median of frames spread
 * over it (words left out). Returns each cut's plate pixels (or null), and
 * with `job.crops` writes them as `<stem>.plate-N.png`.
 */
async function plates(samples, words, info, cuts) {
  const masked = words.filter((w) => w.masked);
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < info.duration), info.duration];
  // Which samples each cut keeps, evenly spread.
  const keep = new Set();
  for (let k = 0; k + 1 < bounds.length; k++) {
    const idx = samples.map((s, i) => (cutOf(bounds, s.t) === k ? i : -1)).filter((i) => i >= 0);
    const n = Math.min(PLATE_FRAMES, idx.length);
    for (let j = 0; j < n; j++) keep.add(idx[Math.floor(((j + 0.5) * idx.length) / n)]);
  }
  const stem = basename(job.out).replace(/\.observations\.json$/, "").replace(/\.json$/, "");
  const pixels = new Map();
  const meta = [];
  const writes = [];
  let frames = [];
  let cut = -1;
  let size = null;
  const close = () => {
    if (cut < 0 || !frames.length) return;
    const plate = makePlate(frames, size.width, size.height);
    frames = [];
    if (!plate || plate.seen < 0.05) return;
    pixels.set(cut, plate.rgb);
    if (job.crops) {
      const image = `${stem}.plate-${meta.length + 1}.png`;
      meta.push({ start: bounds[cut], end: bounds[cut + 1], image, seen: Math.round(plate.seen * 1000) / 1000 });
      writes.push(writePng(join(dirname(job.out), image), plate.rgb, size.width, size.height));
    }
  };
  const reader = ppmReader();
  let i = 0;
  await run(
    job.ffmpeg,
    [
      "-v", "error", "-t", String(MAX_SECONDS), "-i", job.video,
      "-vf", `fps=${OCR_FPS}:round=up`, "-f", "image2pipe", "-vcodec", "ppm", "-",
    ],
    {
      onStdout: (d) => {
        for (const frame of reader.push(d)) {
          const index = i++;
          const s = samples[index];
          if (!s) continue;
          const k = cutOf(bounds, s.t);
          if (k !== cut) {
            close();
            cut = k;
          }
          size = { width: frame.width, height: frame.height };
          if (keep.has(index))
            frames.push({ rgb: new Uint8Array(frame.rgb), busy: wordsAt(masked, s.t).map((w) => wordArea(w.box)) });
          emit({ type: "progress", step: "plates", done: i, total: samples.length });
        }
      },
    },
  );
  close();
  await Promise.all(writes);
  return { bounds, pixels, meta };
}

/**
 * Second pass over the frames, once the words and plates are known: the
 * pictures of each sample are what differs from its cut's plate, with every
 * word the renderer draws left out for as long as it is on screen, coming in
 * included (blurred, OCR cannot read it yet, and it rises from below).
 */
async function visualSamples(samples, words, plate) {
  const masked = words.filter((w) => w.masked);
  const reader = ppmReader();
  let i = 0;
  await run(
    job.ffmpeg,
    [
      "-v", "error", "-t", String(MAX_SECONDS), "-i", job.video,
      "-vf", `fps=${OCR_FPS}:round=up`, "-f", "image2pipe", "-vcodec", "ppm", "-",
    ],
    {
      onStdout: (d) => {
        for (const frame of reader.push(d)) {
          const s = samples[i++];
          if (!s) continue;
          const on = wordsAt(masked, s.t);
          const bg =
            plate.pixels.get(cutOf(plate.bounds, s.t)) ??
            s.background.match(/\w\w/g).map((h) => parseInt(h, 16));
          s.visuals = visualsOf(frame.rgb, frame.width, frame.height, bg, on.map((w) => wordArea(w.box)));
          // The colour behind a word, read once it has settled: what hides it
          // in a picture shown with the text (a card's, not always the background's).
          for (const w of on)
            if (!w.around && s.t >= w.settled) {
              const c = aroundColor(frame.rgb, frame.width, frame.height, wordArea(w.box));
              if (c) w.around = hex(c);
            }
          emit({ type: "progress", step: "pictures", done: i, total: samples.length });
        }
      },
    },
  );
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
      const word = { text: track.text, ...track.box };
      const t = timing(curve, TIME_FPS, best, { from, to });
      // OCR read it, so it was there: a presence that rises later (the word
      // moved since, so its picture of reference differs) is not its start.
      const read = t.start > track.first;
      const timed = {
        ...track,
        start: read ? track.first : t.start,
        settled: read ? track.first : t.settled,
        end: Math.max(t.end, track.last),
      };
      return {
        ...timed,
        // Left out of the pictures (the renderer draws it), or a logo's lettering.
        masked: isMasked(word, info.height) && isReliable(timed),
        mark: isMark(word),
      };
    });

    if (job.crops)
      for (const f of readdirSync(dirname(job.out)))
        if (f.startsWith(`${basename(job.out).replace(/\.observations\.json$/, "")}.plate-`))
          rmSync(join(dirname(job.out), f), { force: true });
    const plate = await plates(samples, words, info, cuts);
    await visualSamples(samples, words, plate);
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
      plates: plate.meta,
      thumbs: samples.length
        ? {
            cols: samples[0].thumb.cols,
            rows: samples[0].thumb.rows,
            frames: samples.map((s) => ({ t: s.t, rgb: s.thumb.rgb })),
          }
        : null,
    };
    writeFileSync(job.out, JSON.stringify(out, null, 1));
    emit({ type: "done", file: job.out, words: out.words.length, cuts: cuts.length });
  } catch (e) {
    emit({ type: "error", message: String(e?.message ?? e).split("\n")[0] });
    process.exitCode = 1;
  }
}

main();
