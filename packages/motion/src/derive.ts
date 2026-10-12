import type {
  Box,
  Observations,
  ObservedRule,
  ObservedVisual,
  ObservedWord,
} from "./observations.ts";
import type {
  Cover,
  Label,
  Line,
  MotionSpec,
  Shot,
  TextShot,
  Visual,
  VisualPoint,
  Word,
} from "./schema.ts";

// From measurements to a first motion spec, without any AI: shots between the
// cuts, text shots where words come and go together, lines by height, font
// size from the letters, accent from colour, underline and strikes from the
// coloured lines. An AI (or a person) then corrects what OCR misread.

export const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Distance between two colours, 0 (same) to 1 (black vs white). */
export function colorDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 441.7;
}

/**
 * How colourful a colour is, 0 (grey, black, white) to 1: its chroma. Not the
 * HSV saturation, which calls a near black (#090b12) half saturated.
 */
export const saturation = (hex: string) => {
  const c = rgb(hex);
  return (Math.max(...c) - Math.min(...c)) / 255;
};

const round = (n: number, k = 1000) => Math.round(n * k) / k;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const overlap = (a: Box, b: Box) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.min(a.w * a.h, b.w * b.h || 1);
};

/**
 * Words worth keeping: read more than once (or very surely), and only the
 * best reading where OCR saw two words in the same place at the same time.
 */
export function cleanWords(words: ObservedWord[]): ObservedWord[] {
  // A lone letter read once is a piece of something else (a logo, an icon).
  const kept = words.filter(
    (w) =>
      (w.seen >= 2 || (w.conf >= 90 && w.end - w.start >= 0.3 && w.text.length > 1)) &&
      w.end > w.start,
  );
  const score = (w: ObservedWord) => w.seen * w.conf;
  return kept.filter(
    (w) =>
      !kept.some(
        (o) =>
          o !== w &&
          overlap(o.box, w.box) > 0.5 &&
          Math.min(o.end, w.end) - Math.max(o.start, w.start) > 0 &&
          (score(o) > score(w) || (score(o) === score(w) && o.box.w > w.box.w)),
      ),
  );
}

/** Words that are on screen together, chained by overlapping times. */
export function groupByTime(words: ObservedWord[]): ObservedWord[][] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const groups: ObservedWord[][] = [];
  let end = -1;
  for (const w of sorted) {
    if (groups.length && w.start < end - 0.05) {
      groups[groups.length - 1].push(w);
      end = Math.max(end, w.end);
    } else {
      groups.push([w]);
      end = w.end;
    }
  }
  return groups;
}

// Letters that go below the baseline.
const DESCENDS = /[gjpqyç,;]/;

/** Rows of words: boxes that share most of their height. */
export function linesOf(words: ObservedWord[]): ObservedWord[][] {
  const rows: ObservedWord[][] = [];
  for (const w of [...words].sort((a, b) => a.box.y - b.box.y)) {
    const row = rows.find((r) => {
      const top = Math.max(...r.map((x) => x.box.y));
      const bottom = Math.min(...r.map((x) => x.box.y + x.box.h));
      return Math.min(bottom, w.box.y + w.box.h) - Math.max(top, w.box.y) >
        0.4 * Math.min(w.box.h, ...r.map((x) => x.box.h));
    });
    if (row) row.push(w);
    else rows.push([w]);
  }
  for (const r of rows) r.sort((a, b) => a.box.x - b.box.x);
  return rows;
}

/** Baseline of a row, in source pixels. */
export function baselineOf(row: ObservedWord[]): number {
  const flat = row.filter((w) => !DESCENDS.test(w.text));
  if (flat.length) return Math.max(...flat.map((w) => w.box.y + w.box.h));
  return median(row.map((w) => w.box.y + w.box.h * 0.8));
}

/**
 * Font size of a row, in source pixels: a capital or an ascender is about
 * 0.73 of the size above the baseline (Inter-like grotesques).
 */
export function fontSizeOf(row: ObservedWord[]): number {
  const base = baselineOf(row);
  const tall = row.filter((w) => {
    const plain = w.text.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return plain === w.text && /[A-Zbdfhklt]/.test(w.text);
  });
  // The median top: an accent OCR read without it (« À » as « A ») stands taller.
  const tops = (tall.length ? tall : row).map((w) => w.box.y);
  const height = base - median(tops);
  return tall.length ? height / 0.73 : height / 0.75;
}

const at = (backgrounds: Observations["backgrounds"], t: number) =>
  backgrounds.reduce(
    (best, b) => (Math.abs(b.t - t) < Math.abs(best.t - t) ? b : best),
    backgrounds[0] ?? { t: 0, color: "#ffffff" },
  ).color;

const inkOf = (words: ObservedWord[], bg: string) => {
  const colors = words.map((w) => w.color).filter((c): c is string => !!c);
  const plain = colors.filter((c) => saturation(c) < 0.2);
  const pick = plain.length ? plain : colors;
  if (!pick.length) return colorDistance(bg, "#000000") > 0.5 ? "#0b0f19" : "#ffffff";
  // The colour furthest from the background is the truest (no antialiasing).
  return pick.reduce((a, b) => (colorDistance(b, bg) > colorDistance(a, bg) ? b : a));
};

const isAccent = (color: string | null, ink: string) =>
  !!color && saturation(color) > 0.35 && colorDistance(color, ink) > 0.25;

function textShot(
  id: string,
  group: ObservedWord[],
  rules: ObservedRule[],
  obs: Observations,
  start: number,
  end: number,
  exit: TextShot["exit"],
): TextShot {
  const H = obs.height;
  const background = at(obs.backgrounds, (start + end) / 2);
  const ink = inkOf(group, background);
  // A mark much shorter than its neighbours (a bullet read as « e ») is not a word.
  const rows = linesOf(group)
    .map((r) => {
      const h = median(r.map((w) => w.box.h));
      return r.filter((w) => w.text.length > 1 || w.box.h > h * 0.6);
    })
    .filter((r) => r.length);
  const sizes = rows.map(fontSizeOf);
  const main = Math.max(...sizes);
  // A much smaller row above the others is a kicker; the rest are lines.
  const kickerRow =
    rows.length > 1 && sizes[0] < main * 0.5 ? rows.shift() : undefined;
  if (kickerRow) sizes.shift();
  // A tiny row below them is not part of the text (a logo's baseline, a
  // credit): it stays in the pictures, and the lines keep their place.
  for (let i = rows.length - 1; i > 0; i--)
    if (sizes[i] < main * 0.35) {
      rows.splice(i, 1);
      sizes.splice(i, 1);
    }
  const size = median(sizes);
  const lastBase = baselineOf(rows[rows.length - 1]);
  const left = Math.min(...rows.map((r) => r[0].box.x));

  const inShot = rules.filter((r) => r.t >= start - 0.01 && r.t < end);
  // A strike crosses the middle of a word; an underline sits below the text.
  const struck = (w: ObservedWord) =>
    inShot.find(
      (r) =>
        r.y > w.box.y + w.box.h * 0.25 &&
        r.y < w.box.y + w.box.h * 0.85 &&
        r.x < w.box.x + w.box.w * 0.3 &&
        r.x + r.w > w.box.x + w.box.w * 0.7,
    )?.t;
  // It may start left of the text (under a bullet, a chip, a word kept as a
  // picture) as long as it runs under it, and sit lower under chips (another
  // row of text would be words, not a line).
  const under = inShot.filter(
    (r) =>
      r.y > lastBase &&
      r.y < lastBase + size * 1.3 &&
      r.x < left + size * 0.4 &&
      r.x + r.w > left + size,
  );
  const accentColor =
    under[0]?.color ??
    group.find((w) => isAccent(w.color, ink))?.color ??
    "#1f4fe8";

  const lines: Line[] = rows.map((row) => ({
    words: row.map(
      (w): Word => ({
        text: w.text,
        at: round(Math.max(start, w.start)),
        accent: isAccent(w.color, ink),
        echo: false,
        x: round(w.box.x / obs.width, 10000),
        w: round(w.box.w / obs.width, 10000),
        ...(struck(w) !== undefined ? { strike: round(struck(w) as number) } : {}),
      }),
    ),
  }));

  const shot: TextShot = {
    kind: "text",
    id,
    start: round(start),
    end: round(end),
    background,
    ink,
    accent: accentColor,
    x: round(left / obs.width, 10000),
    y: round(lastBase / H, 10000),
    size: round(size / H, 10000),
    weight: 600,
    lineHeight: rows.length > 1
      ? round((baselineOf(rows[1]) - baselineOf(rows[0])) / size, 100)
      : 1.1,
    lines,
    enter: { y: 0.35, blur: 0.12, duration: 0.35, ease: [0.22, 1, 0.36, 1] },
    exit,
    visuals: [],
  };
  if (kickerRow)
    shot.kicker = {
      text: kickerRow.map((w) => w.text).join(" "),
      at: round(Math.max(start, Math.min(...kickerRow.map((w) => w.start)))),
      gap: round((rows[0][0].box.y - (kickerRow[0].box.y + kickerRow[0].box.h)) / size, 100),
    };
  if (under.length) {
    const u = under[0];
    shot.underline = {
      at: round(start),
      ...(Math.abs(u.x - left) > size * 0.2 ? { x: round(u.x / obs.width, 10000) } : {}),
      offset: round((u.y - lastBase) / size, 100),
      thickness: round(Math.max(1, u.h) / size, 1000),
      overshoot: 0.1,
    };
  }
  return shot;
}

/**
 * The area a word drawn as text takes while it is on screen, coming in
 * included (the analyser's `wordArea`).
 */
const wordArea = (b: Box): Box => ({
  x: b.x - b.h * 0.2,
  y: b.y - b.h * 0.3,
  w: b.w + b.h * 0.4,
  h: b.h * 1.9,
});

/** How much of a box the words take (0..1), each word with its margin. */
function coveredBy(box: Box, words: ObservedWord[]): number {
  let covered = 0;
  for (const { box: b } of words) {
    const a = wordArea(b);
    const x = Math.max(0, Math.min(box.x + box.w, a.x + a.w) - Math.max(box.x, a.x));
    const y = Math.max(0, Math.min(box.y + box.h, a.y + a.h) - Math.max(box.y, a.y));
    covered += x * y;
  }
  return Math.min(1, covered / (box.w * box.h || 1));
}

/** A visual's path as the renderer reads it: centre and scale, edges undone. */
export function visualPath(
  v: ObservedVisual,
  width: number,
  height: number,
): VisualPoint[] {
  if (v.kind === "clip" || v.path.length < 2) return [];
  // The picture at rest (the analyser cut it with a 4 px margin).
  const rest = v.path.reduce((a, p) =>
    Math.abs(p.w * p.h - (v.box.w - 8) * (v.box.h - 8)) <
    Math.abs(a.w * a.h - (v.box.w - 8) * (v.box.h - 8))
      ? p
      : a,
  );
  const points = v.path.map((p): VisualPoint => {
    // Cut by an edge of the frame (coming in, going out): its size is the
    // other side's, and it hangs from the edge that is not cut.
    const cutX = (p.x <= 1 || p.x + p.w >= width - 1) && p.w < rest.w * 0.97;
    const cutY = (p.y <= 1 || p.y + p.h >= height - 1) && p.h < rest.h * 0.97;
    const scale = cutX && cutY ? 1 : cutX ? p.h / rest.h : cutY ? p.w / rest.w : (p.w / rest.w + p.h / rest.h) / 2;
    const w = rest.w * scale;
    const h = rest.h * scale;
    const x = cutX && p.x <= 1 ? p.x + p.w - w : p.x;
    const y = cutY && p.y <= 1 ? p.y + p.h - h : p.y;
    return {
      t: round(p.t),
      x: round((x + w / 2) / width, 10000),
      y: round((y + h / 2) / height, 10000),
      scale: round(scale, 1000),
    };
  });
  // Only the points where it moved; none at all if it never did.
  const kept = [points[0]];
  for (const p of points.slice(1)) {
    const q = kept[kept.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) > 0.004 || Math.abs(p.scale - q.scale) > 0.015) kept.push(p);
  }
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  const centre = { x: (rest.x + rest.w / 2) / width, y: (rest.y + rest.h / 2) / height };
  const still = kept.every(
    (p) => Math.hypot(p.x - centre.x, p.y - centre.y) < 0.006 && Math.abs(p.scale - 1) < 0.03,
  );
  return still ? [] : kept;
}

/**
 * The pictures of a shot, from the visuals the analyser cut out. In a text shot, a picture that is mostly
 * its words is the text itself (blurred while it comes in, a word OCR did not
 * keep) and the thin coloured lines are its underline or strikes: the
 * renderer draws those, so only what is around the text stays (a chip, a
 * bullet, an echo).
 */
export function visualsFor(
  obs: Observations,
  start: number,
  end: number,
  words: ObservedWord[] | null,
): Visual[] {
  const { width: W, height: H } = obs;
  // The words there with it for a good part of its time, coming in included
  // (blurred before OCR reads them): not one leaving as it comes in, nor one
  // that only starts once it is gone (the next shot's, at the same place).
  const during = (v: ObservedVisual) =>
    (words ?? []).filter(
      (w) =>
        w.start < v.end &&
        Math.min(v.end, w.end + 0.2) - Math.max(v.start, w.start - 0.4) > 0.25 * (v.end - v.start),
    );
  // A thin piece on the row of an underline or a strike (its tip, drawing in)
  // is that line: the renderer draws it.
  const onRule = (v: ObservedVisual) =>
    obs.rules.some(
      (r) =>
        r.t >= v.start - 0.3 &&
        r.t <= v.end &&
        r.y < v.box.y + v.box.h + 6 &&
        r.y + r.h > v.box.y - 6,
    );
  return obs.visuals
    .filter((v) => v.image && v.start < end && v.end > start)
    // Seen once: a flash of a transition, or noise (its presence, measured
    // against a picture of almost nothing, may last; it is not there).
    .filter((v) => v.path.length >= 2)
    .filter(
      (v) =>
        !words ||
        (coveredBy(v.box, during(v)) < 0.6 &&
          !(v.box.h <= H * 0.025 && (v.box.w > W * 0.03 || onRule(v)))),
    )
    // The biggest behind.
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .map((v): Visual => {
      const path = visualPath(v, W, H);
      // A clip is the video itself, its way in and out included: no fade on top.
      const clip = v.kind === "clip";
      const fadeIn = path.length || clip ? 0 : Math.min(1, Math.max(0, v.settled - v.start));
      return {
        kind: v.kind,
        src: v.image as string,
        x: round(v.box.x / W, 10000),
        y: round(v.box.y / H, 10000),
        w: round(v.box.w / W, 10000),
        h: round(v.box.h / H, 10000),
        at: round(v.start),
        fadeIn: round(fadeIn),
        until: round(Math.max(v.end, v.start + 0.05)),
        // Leaves before the cut: it went away on its own, softly.
        fadeOut: !clip && v.end < end - 0.1 ? 0.15 : 0,
        path,
        covers: coversOf(v, during(v), W, H),
      };
    });
}

/**
 * Patches over a picture of a text shot where its words are (a chip around a
 * word: the chip stays, the word is drawn as text): the colour around each
 * word, for as long as it is on screen, cut to the picture.
 */
function coversOf(v: ObservedVisual, words: ObservedWord[], W: number, H: number): Cover[] {
  return words.flatMap((w) => {
    if (!w.masked || !w.around) return [];
    const a = wordArea(w.box);
    const x = Math.max(a.x, v.box.x);
    const y = Math.max(a.y, v.box.y);
    const x1 = Math.min(a.x + a.w, v.box.x + v.box.w);
    const y1 = Math.min(a.y + a.h, v.box.y + v.box.h);
    if (x1 <= x || y1 <= y) return [];
    return [
      {
        x: round(x / W, 10000),
        y: round(y / H, 10000),
        w: round((x1 - x) / W, 10000),
        h: round((y1 - y) / H, 10000),
        color: w.around,
        at: round(Math.max(0, w.start - 0.4)),
        until: round(w.end + 0.2),
      },
    ];
  });
}

/**
 * The words of a shot that is not kinetic text that the pictures were cut
 * without (`masked`): they are drawn as text at their measured place. A word
 * inside a picture is already in it (a figure on a dashboard).
 */
export function labelsFor(
  obs: Observations,
  words: ObservedWord[],
  visuals: Visual[],
): Label[] {
  const { width: W, height: H } = obs;
  const bg = at(obs.backgrounds, words[0]?.settled ?? 0);
  return words
    .filter((w) => w.masked)
    .filter(
      (w) =>
        !visuals.some(
          (v) => overlap({ x: v.x * W, y: v.y * H, w: v.w * W, h: v.h * H }, w.box) > 0.5,
        ),
    )
    .map((w) => ({
      text: w.text,
      x: round(w.box.x / W, 10000),
      y: round(baselineOf([w]) / H, 10000),
      size: round(fontSizeOf([w]) / H, 10000),
      color: w.color ?? inkOf([w], bg),
      weight: 600,
      at: round(w.start),
      fadeIn: round(Math.min(0.6, Math.max(0, w.settled - w.start))),
      until: round(Math.max(w.end, w.start + 0.05)),
    }));
}

/**
 * Kinetic text: a few large words at a time. Many small ones together are an
 * interface or a page, which goScreen does not rebuild yet.
 */
export function isKineticText(groups: ObservedWord[][], height: number) {
  return groups.every(
    (g) =>
      g.length <= 14 &&
      Math.max(...linesOf(g).map(fontSizeOf)) >= height * 0.035,
  );
}

/**
 * Words that lie on a picture, there while they are, belong to it (the
 * figures of a dashboard, the title of a page): they are not kinetic text.
 */
export function onPicture(obs: Observations, words: ObservedWord[]): boolean {
  const from = Math.min(...words.map((w) => w.start));
  const to = Math.max(...words.map((w) => w.end));
  return obs.visuals.some((v) => {
    if (!v.image || v.start > from + 0.1 || v.end < to - 0.1) return false;
    const on = words.filter((w) => overlap(v.box, w.box) > 0.8);
    if (on.length * 2 < words.length) return false;
    // Much bigger than its words: a picture that holds them, not the words
    // themselves (seen blurred while they came in, or their echo above).
    const x = Math.min(...on.map((w) => w.box.x));
    const y = Math.min(...on.map((w) => w.box.y));
    const w = Math.max(...on.map((o) => o.box.x + o.box.w)) - x;
    const h = Math.max(...on.map((o) => o.box.y + o.box.h)) - y;
    return v.box.w * v.box.h >= 8 * w * h;
  });
}

/** A first motion spec from the measurements of a video. */
export function specFromObservations(obs: Observations): MotionSpec {
  // A logo's lettering stays in its picture.
  const words = cleanWords(obs.words).filter((w) => !w.mark);
  const bounds = [0, ...obs.cuts.filter((c) => c > 0 && c < obs.duration), obs.duration];
  const shots: Shot[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [from, to] = [bounds[i], bounds[i + 1]];
    const inside = words.filter((w) => {
      const mid = (w.start + w.settled) / 2;
      return mid >= from && mid < to;
    });
    const groups = groupByTime(inside);
    // Each group of words is kinetic text, or part of a picture (a slide, a
    // logo card, an interface); pictures that follow each other are one shot.
    const segments: { text: boolean; words: ObservedWord[] }[] = [];
    for (const g of groups) {
      const text = isKineticText([g], obs.height) && !onPicture(obs, g);
      const last = segments[segments.length - 1];
      if (!text && last && !last.text) last.words.push(...g);
      else segments.push({ text, words: [...g] });
    }
    if (!segments.length) segments.push({ text: false, words: [] });
    let start = from;
    segments.forEach((seg, k) => {
      const lastOne = k === segments.length - 1;
      const end = lastOne
        ? to
        : Math.max(start + 0.1, ...seg.words.map((w) => w.end));
      const id = `shot-${shots.length + 1}`;
      if (seg.text) {
        const shot = textShot(id, seg.words, obs.rules, obs, start, end, lastOne ? "cut" : "blur");
        // Every word of the cut, not only this group's: a word in transit
        // belongs to the text, whichever group it ends up in.
        shot.visuals = visualsFor(obs, shot.start, shot.end, inside);
        shots.push(shot);
      } else {
        const visuals = visualsFor(obs, start, end, null);
        shots.push({
          kind: "placeholder",
          id,
          start: round(start),
          end: round(end),
          background: at(obs.backgrounds, (start + end) / 2),
          label: seg.words.length ? "interface" : visuals.length ? "picture" : "",
          visuals,
          labels: labelsFor(obs, seg.words, visuals),
        });
      }
      start = end;
    });
  }
  return {
    version: 1,
    width: obs.width,
    height: obs.height,
    fps: obs.fps,
    duration: round(obs.duration),
    fonts: {
      text: "'Inter Display', 'Inter', 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif",
      mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
    },
    shots,
  };
}
