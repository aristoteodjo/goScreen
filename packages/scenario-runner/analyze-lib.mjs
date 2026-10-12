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

const rgbOf = (h) => h.match(/\w\w/g).map((x) => parseInt(x, 16));

/**
 * A word's colour: the reading furthest from the background. Coming in and
 * leaving it is blurred or fading, so paler; sharp, it is its true colour.
 */
export function sharpestColor(readings) {
  let best = null;
  let far = -1;
  for (const w of readings) {
    if (!w.color) continue;
    const d = dist(rgbOf(w.color), rgbOf(w.background ?? "#ffffff"));
    if (d > far) {
      far = d;
      best = w.color;
    }
  }
  return best;
}

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
        t.seen.push({ t: s.t, background: s.background, ...w });
        t.texts.push(w);
        if (w.conf > t.best.conf) t.best = { t: s.t, ...w };
      } else
        tracks.push({
          first: s.t,
          last: s.t,
          lastT: s.t,
          box: w,
          texts: [w],
          seen: [{ t: s.t, background: s.background, ...w }],
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
      color: sharpestColor(k.seen),
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

/** A word this tall (fraction of the frame height) is drawn as text by the renderer. */
export const BIG_WORD = 0.03;

/**
 * Lettering of a logo rather than text: letters spread far apart (a
 * wordmark like « R E M A I N »). Text, even in capitals, is about one letter
 * height wide per letter; such a word stays in the picture it belongs to.
 */
export const isMark = (w) => w.text.length >= 3 && w.w / (w.text.length * w.h) > 1.2;

/**
 * A reading the motion spec keeps (the same rule as `cleanWords` in
 * @goscreen/motion): read more than once, or very surely for a while.
 */
export const isReliable = (w) =>
  w.seen >= 2 || (w.conf >= 90 && w.end - w.start >= 0.3 && w.text.length > 1);

/**
 * A word the renderer draws as text, so the pictures leave it out: big, not
 * a logo's lettering, and kept by the spec (a word misread once stays in the
 * picture, with its true pixels).
 */
export const isMasked = (w, height) => w.h >= height * BIG_WORD && !isMark(w);

// Visual elements: whatever is not the background nor a big word (a logo, an
// interface, a bullet, a shape). Found on a grid of cells, followed across
// samples, then cut out of the video as images the renderer can place.

/** Grid of cells that differ from the background, big words left out. */
export function visualCells(rgb, width, height, bg, { cell, skip = [], threshold = 18 }) {
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const on = new Uint8Array(gw * gh);
  const skipped = (x, y) =>
    skip.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  for (let cy = 0; cy < gh; cy++)
    for (let cx = 0; cx < gw; cx++) {
      const x1 = Math.min(width, (cx + 1) * cell);
      const y1 = Math.min(height, (cy + 1) * cell);
      let hit = false;
      for (let y = cy * cell; y < y1 && !hit; y += 2)
        for (let x = cx * cell; x < x1 && !hit; x += 2) {
          const i = (y * width + x) * 3;
          if (dist([rgb[i], rgb[i + 1], rgb[i + 2]], bg) > threshold && !skipped(x, y)) hit = true;
        }
      on[cy * gw + cx] = hit ? 1 : 0;
    }
  return { on, gw, gh };
}

/**
 * Boxes (in cells) of groups of lit cells; cells up to `gap` cells apart
 * belong together, so an interface with text inside stays one element.
 */
export function cellGroups({ on, gw, gh }, gap = 1) {
  const seen = new Uint8Array(on.length);
  const boxes = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue;
    const box = { x0: gw, y0: gh, x1: -1, y1: -1, n: 0 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % gw;
      const y = (i - x) / gw;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      box.n++;
      for (let dy = -gap - 1; dy <= gap + 1; dy++)
        for (let dx = -gap - 1; dx <= gap + 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          if (on[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    boxes.push(box);
  }
  // Boxes that overlap (a card around a group) are one element.
  for (let merged = true; merged; ) {
    merged = false;
    for (let a = 0; a < boxes.length && !merged; a++)
      for (let b = a + 1; b < boxes.length && !merged; b++) {
        const p = boxes[a];
        const q = boxes[b];
        if (p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1) {
          boxes[a] = {
            x0: Math.min(p.x0, q.x0),
            y0: Math.min(p.y0, q.y0),
            x1: Math.max(p.x1, q.x1),
            y1: Math.max(p.y1, q.y1),
            n: p.n + q.n,
          };
          boxes.splice(b, 1);
          merged = true;
        }
      }
  }
  return boxes;
}

/**
 * An 8×8 grey thumbnail of a box, each tile the mean of a few points: enough
 * to tell two pictures apart, steady enough not to flicker on small text.
 */
export function thumbnail(rgb, width, box) {
  const out = new Array(64).fill(0);
  for (let ty = 0; ty < 8; ty++)
    for (let tx = 0; tx < 8; tx++) {
      let sum = 0;
      for (let py = 0; py < 4; py++)
        for (let px = 0; px < 4; px++) {
          const x = Math.min(width - 1, Math.floor(box.x + ((tx + (px + 0.5) / 4) * box.w) / 8));
          const y = Math.floor(box.y + ((ty + (py + 0.5) / 4) * box.h) / 8);
          const i = (y * width + x) * 3;
          sum += 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
        }
      out[ty * 8 + tx] = Math.round(sum / 16);
    }
  return out;
}

/**
 * The visual elements of one frame, in pixels: lit cells grouped, the areas
 * of `skip` (words drawn as text by the renderer, with their margin) left out.
 */
export function visualsOf(rgb, width, height, bg, skip = []) {
  const cell = Math.max(4, Math.round(width / 240));
  return cellGroups(visualCells(rgb, width, height, bg, { cell, skip }))
    .map((b) => {
      const x = b.x0 * cell;
      const y = b.y0 * cell;
      const box = {
        x,
        y,
        w: Math.min(width, (b.x1 + 1) * cell) - x,
        h: Math.min(height, (b.y1 + 1) * cell) - y,
      };
      return { ...box, thumb: thumbnail(rgb, width, box) };
    })
    .filter((v) => v.w >= cell && v.h >= cell);
}

/** The share of box `a` inside box `b`. */
const inside = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h || 1);
};

const thumbDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < 64; i++) s += Math.abs(a[i] - b[i]);
  return s / 64;
};

/**
 * The same element in successive samples is one track: near where it was,
 * about the same size, and not a different picture. `changes` says how much
 * it changes inside (an interface that animates) compared with its picture
 * of reference: such a track is better replayed as a clip than as an image.
 */
export function trackVisuals(samples, { maxGap = 0.6, maxDiff = 60 } = {}) {
  const tracks = [];
  for (const s of samples) {
    const free = tracks.filter((k) => s.t - k.last <= maxGap);
    for (const v of s.visuals ?? []) {
      const fit = free
        .filter((k) => k.last !== s.t)
        .map((k) => {
          const p = k.seen[k.seen.length - 1];
          const d = Math.hypot(p.x + p.w / 2 - (v.x + v.w / 2), p.y + p.h / 2 - (v.y + v.h / 2));
          const ratio = (v.w * v.h) / (p.w * p.h);
          const ok = d <= 0.6 * Math.max(p.w, p.h, v.w, v.h) && ratio > 0.5 && ratio < 2 &&
            thumbDiff(p.thumb, v.thumb) < maxDiff;
          return { k, d, ok };
        })
        .filter((m) => m.ok)
        .sort((a, b) => a.d - b.d)[0];
      const reading = { t: s.t, background: s.background, ...v };
      if (fit) {
        fit.k.last = s.t;
        fit.k.seen.push(reading);
      } else tracks.push({ first: s.t, last: s.t, seen: [reading] });
    }
    // Something that appears around an element (a glow behind a logo) makes
    // one bigger piece with it: the element is still there, where it was, for
    // a sample (longer, the piece is something else at its place).
    for (const k of free) {
      if (k.last === s.t) continue;
      const p = k.seen[k.seen.length - 1];
      if (p.held) continue;
      const around = (s.visuals ?? []).some(
        (v) => v.w * v.h >= 2 * p.w * p.h && inside(p, v) >= 0.9,
      );
      if (around) {
        k.last = s.t;
        // Held, not seen: never its picture of reference.
        k.seen.push({ ...p, t: s.t, held: true });
      }
    }
  }
  return tracks.map((k) => {
    // The picture of reference: at rest (its most common size), late rather
    // than early (it may still be coming in), and looking the most like it
    // usually does (the median of its looks): not a frame coming in, fading,
    // or of a transition.
    const seen = k.seen.filter((v) => !v.held);
    const areas = seen.map((v) => v.w * v.h).sort((a, b) => a - b);
    const typical = areas[Math.floor(areas.length / 2)];
    const rest = seen.filter((v) => Math.abs(v.w * v.h - typical) <= typical * 0.1);
    const late = rest.filter((v) => seen.indexOf(v) >= seen.length / 3);
    const atRest = late.length ? late : rest;
    const look = atRest[0].thumb.map((_, i) => {
      const c = atRest.map((v) => v.thumb[i]).sort((a, b) => a - b);
      return c[Math.floor(c.length / 2)];
    });
    const best = atRest.reduce((a, v) => (thumbDiff(v.thumb, look) < thumbDiff(a.thumb, look) ? v : a), atRest[0]);
    return {
      first: k.first,
      last: k.last,
      best: best.t,
      box: { x: best.x, y: best.y, w: best.w, h: best.h },
      changes: Math.max(...seen.map((v) => thumbDiff(v.thumb, best.thumb))),
      path: k.seen.map((v) => ({ t: v.t, x: v.x, y: v.y, w: v.w, h: v.h })),
    };
  });
}

/** The box that holds every position of a track. */
export function unionBox(path) {
  const x = Math.min(...path.map((b) => b.x));
  const y = Math.min(...path.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...path.map((b) => b.x + b.w)) - x,
    h: Math.max(...path.map((b) => b.y + b.h)) - y,
  };
}

/**
 * The area a word drawn as text takes while it is on screen, its margin
 * included (it comes in blurred, rising from below): left out of the
 * pictures the analyser looks for.
 */
export const wordArea = (b) => ({
  x: b.x - b.h * 0.2,
  y: b.y - b.h * 0.3,
  w: b.w + b.h * 0.4,
  h: b.h * 1.9,
});

/** The colour just around a box (a ring a few pixels outside), median per channel. */
export function aroundColor(rgb, width, height, box, gap = 3, ring = 4) {
  const c = [[], [], []];
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.floor(y) * width + Math.floor(x)) * 3;
    for (let k = 0; k < 3; k++) c[k].push(rgb[i + k]);
  };
  for (let d = gap; d < gap + ring; d++) {
    for (let x = box.x - d; x <= box.x + box.w + d; x += 2) {
      add(x, box.y - d);
      add(x, box.y + box.h + d);
    }
    for (let y = box.y - d; y <= box.y + box.h + d; y += 2) {
      add(box.x - d, y);
      add(box.x + box.w + d, y);
    }
  }
  if (!c[0].length) return null;
  return c.map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]);
}
