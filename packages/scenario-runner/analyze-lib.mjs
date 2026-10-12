// Pure helpers of the video analyser (analyze.mjs), tested with `node --test`.
// Frames come in as raw pixels: RGB (3 bytes) for the OCR samples, grey
// (1 byte) for the small frames that time everything.

/**
 * Splits a stream of binary PPM images (P6, as FFmpeg's image2pipe writes
 * them). `push` returns the complete images found so far.
 */
export function ppmReader() {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const out = [];
      for (;;) {
        const head = buf
          .subarray(0, 64)
          .toString("latin1")
          .match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/);
        if (!head) break;
        const width = Number(head[1]);
        const height = Number(head[2]);
        const start = head[0].length;
        const end = start + width * height * 3;
        if (buf.length < end) break;
        out.push({
          width,
          height,
          ppm: buf.subarray(0, end),
          rgb: buf.subarray(start, end),
        });
        buf = buf.subarray(end);
      }
      return out;
    },
  };
}

/** Words of a Tesseract TSV, confident and with a letter or a digit. */
export function parseTsv(text, minConf = 50) {
  const words = [];
  for (const row of text.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const conf = Number(c[10]);
    const word = c[11].trim();
    if (conf < minConf || !/[\p{L}\p{N}]/u.test(word)) continue;
    words.push({
      text: word,
      conf: Math.round(conf),
      x: Number(c[6]),
      y: Number(c[7]),
      w: Number(c[8]),
      h: Number(c[9]),
    });
  }
  return words;
}

export const hex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const dist = (a, b) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** The most common colour of the frame's border (quantised to 8 levels). */
export function background(rgb, width, height) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * 3;
    const key = `${rgb[i] >> 5},${rgb[i + 1] >> 5},${rgb[i + 2] >> 5}`;
    const e = counts.get(key) ?? { n: 0, sum: [0, 0, 0] };
    e.n++;
    e.sum[0] += rgb[i];
    e.sum[1] += rgb[i + 1];
    e.sum[2] += rgb[i + 2];
    counts.set(key, e);
  };
  const step = Math.max(1, Math.floor(width / 200));
  for (let x = 0; x < width; x += step) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    add(0, y);
    add(width - 1, y);
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best.sum.map((v) => v / best.n);
}

/** The colour of the ink inside a box: the pixels furthest from the background. */
export function inkColor(rgb, width, box, bg) {
  const px = [];
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * width + x) * 3;
      const c = [rgb[i], rgb[i + 1], rgb[i + 2]];
      const d = dist(c, bg);
      if (d > 120) px.push({ c, d });
    }
  if (!px.length) return null;
  px.sort((a, b) => b.d - a.d);
  const top = px.slice(0, Math.max(1, Math.floor(px.length / 3)));
  const sum = [0, 0, 0];
  for (const { c } of top) for (let k = 0; k < 3; k++) sum[k] += c[k];
  return sum.map((v) => v / top.length);
}

const saturation = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};

/**
 * Horizontal coloured lines (underlines, strikes): runs of saturated pixels
 * longer than `minLength` (fraction of the width), grouped across rows.
 */
export function rules(rgb, width, height, minLength = 0.04) {
  const found = [];
  const min = Math.round(width * minLength);
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const i = (y * width + x) * 3;
      const on =
        x < width &&
        saturation(rgb[i], rgb[i + 1], rgb[i + 2]) > 0.45 &&
        Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) > 90;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= min) found.push({ y, x0: start, x1: x });
        start = -1;
      }
    }
  }
  // Rows that touch and overlap make one rule.
  const merged = [];
  for (const r of found) {
    const m = merged.find(
      (o) =>
        r.y - o.y1 <= 1 &&
        Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0) > 0.8 * (r.x1 - r.x0),
    );
    if (m) {
      m.y1 = r.y;
      m.x0 = Math.min(m.x0, r.x0);
      m.x1 = Math.max(m.x1, r.x1);
    } else merged.push({ y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 });
  }
  // A line is thin; a filled shape (a button, a bar) is not one.
  return merged
    .filter((m) => m.y1 - m.y0 + 1 <= height * 0.02)
    .map((m) => {
      const y = Math.round((m.y0 + m.y1) / 2);
      const i = (y * width + Math.round((m.x0 + m.x1) / 2)) * 3;
      return {
        x: m.x0,
        y: m.y0,
        w: m.x1 - m.x0,
        h: m.y1 - m.y0 + 1,
        color: hex([rgb[i], rgb[i + 1], rgb[i + 2]]),
      };
    });
}

/** Mean absolute difference between two grey frames. */
export function frameDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Hard cuts: a frame that differs a lot from the previous one. */
export function cutsFrom(diffs, fps, threshold = 28) {
  const cuts = [];
  for (let i = 1; i < diffs.length; i++)
    if (diffs[i] > threshold && diffs[i] > 3 * (diffs[i - 1] + 1))
      cuts.push(Math.round((i / fps) * 1000) / 1000);
  return cuts;
}

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Edit distance, for OCR that reads a word slightly differently. */
export function editDistance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = d[j];
      d[j] = Math.min(
        d[j] + 1,
        d[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = keep;
    }
  }
  return d[b.length];
}

const iou = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

const sameWord = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return editDistance(x, y) <= Math.floor(Math.max(x.length, y.length) / 4);
};

/**
 * The same word seen in successive samples, at the same place, is one track.
 * A sample is `{ t, words }`; a gap longer than `maxGap` seconds ends a track.
 */
export function trackWords(samples, maxGap = 0.6) {
  const tracks = [];
  for (const s of samples)
    for (const w of s.words) {
      const t = tracks.find(
        (k) =>
          s.t - k.last <= maxGap &&
          k.lastT !== s.t &&
          iou(k.box, w) > 0.4 &&
          sameWord(k.texts[0].text, w.text),
      );
      if (t) {
        t.last = s.t;
        t.lastT = s.t;
        t.seen.push({ t: s.t, ...w });
        t.texts.push(w);
        if (w.conf > t.best.conf) t.best = { t: s.t, ...w };
      } else
        tracks.push({
          first: s.t,
          last: s.t,
          lastT: s.t,
          box: w,
          texts: [w],
          seen: [{ t: s.t, ...w }],
          best: { t: s.t, ...w },
        });
    }
  return tracks.map((k) => {
    // The reading OCR made most often, with its best confidence.
    const votes = new Map();
    for (const w of k.texts)
      votes.set(w.text, (votes.get(w.text) ?? 0) + w.conf);
    const text = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    const med = (key) => {
      const v = k.seen.map((w) => w[key]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    // The picture of reference: late in the readings, once the word has
    // stopped moving, but not on the very last one (it may be leaving).
    const settledAt = k.seen[Math.floor((k.seen.length * 2) / 3)].t;
    return {
      text,
      conf: k.best.conf,
      settledAt,
      first: k.first,
      last: k.last,
      best: k.best.t,
      box: { x: med("x"), y: med("y"), w: med("w"), h: med("h") },
      seen: k.seen.length,
      color: k.seen.find((w) => w.color)?.color ?? null,
    };
  });
}

/**
 * Presence of a word in each small frame: 1 = exactly as when OCR read it
 * best, 0 = background only (or another picture). `ref` is the patch at that
 * moment, `bg` the background grey.
 */
export function presence(patch, ref, bg) {
  let diff = 0;
  let empty = 0;
  for (let i = 0; i < ref.length; i++) {
    diff += Math.abs(patch[i] - ref[i]);
    empty += Math.abs(bg - ref[i]);
  }
  return empty < 1 ? 0 : Math.max(0, Math.min(1, 1 - diff / empty));
}

/** Pixels of a box in a grey frame, row by row. */
export function patchOf(grey, width, box) {
  const out = new Uint8Array(box.w * box.h);
  for (let y = 0; y < box.h; y++)
    out.set(
      grey.subarray((box.y + y) * width + box.x, (box.y + y) * width + box.x + box.w),
      y * box.w,
    );
  return out;
}

/**
 * When a word comes in, settles and leaves, from its presence per frame and
 * the frame where OCR read it best. Comes in = the presence rises from below
 * `low`; settles = first frame above `high`; leaves = the presence drops
 * below one half after the last reading. The search stays within `[from,
 * to)` frames: around the OCR readings, so a tiny box whose presence is noise
 * cannot drift into another shot.
 */
export function timing(
  curve,
  fps,
  bestFrame,
  { from = 0, to = curve.length, low = 0.15, high = 0.85 } = {},
) {
  let settled = bestFrame;
  while (settled > from && curve[settled - 1] >= high) settled--;
  let start = settled;
  while (start > from && curve[start - 1] >= low && curve[start - 1] <= curve[start] + 0.05)
    start--;
  let end = bestFrame;
  while (end + 1 < to && curve[end + 1] >= 0.5) end++;
  const s = (i) => Math.round((i / fps) * 1000) / 1000;
  return { start: s(start), settled: s(settled), end: s(end + 1) };
}
