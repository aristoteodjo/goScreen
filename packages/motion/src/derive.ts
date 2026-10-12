import type {
  Box,
  Observations,
  ObservedRule,
  ObservedWord,
} from "./observations.ts";
import type { Line, MotionSpec, Shot, TextShot, Word } from "./schema.ts";

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

export const saturation = (hex: string) => {
  const c = rgb(hex);
  const max = Math.max(...c);
  return max === 0 ? 0 : (max - Math.min(...c)) / max;
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
  const kept = words.filter(
    (w) =>
      (w.seen >= 2 || (w.conf >= 90 && w.end - w.start >= 0.3)) &&
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
  const tops = (tall.length ? tall : row).map((w) => w.box.y);
  const height = base - Math.min(...tops);
  return tall.length ? height / 0.73 : height / 0.75;
}

const at = (backgrounds: Observations["backgrounds"], t: number) =>
  backgrounds.reduce(
    (best, b) => (Math.abs(b.t - t) < Math.abs(best.t - t) ? b : best),
    backgrounds[0] ?? { t: 0, color: "#ffffff" },
  ).color;

const inkOf = (words: ObservedWord[], bg: string) => {
  const colors = words.map((w) => w.color).filter((c): c is string => !!c);
  const plain = colors.filter((c) => saturation(c) < 0.35);
  const pick = plain.length ? plain : colors;
  if (!pick.length) return colorDistance(bg, "#000000") > 0.5 ? "#0b0f19" : "#ffffff";
  // The colour furthest from the background is the truest (no antialiasing).
  return pick.reduce((a, b) => (colorDistance(b, bg) > colorDistance(a, bg) ? b : a));
};

const isAccent = (color: string | null, ink: string) =>
  !!color && saturation(color) > 0.45 && colorDistance(color, ink) > 0.25;

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
    rows.length > 1 && sizes[0] < main * 0.45 ? rows.shift() : undefined;
  if (kickerRow) sizes.shift();
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
  const under = inShot.filter(
    (r) =>
      r.y > lastBase &&
      r.y < lastBase + size * 0.7 &&
      Math.abs(r.x - left) < size * 0.4,
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
      offset: round((u.y - lastBase) / size, 100),
      thickness: round(Math.max(1, u.h) / size, 1000),
      overshoot: 0.1,
    };
  }
  return shot;
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

/** A first motion spec from the measurements of a video. */
export function specFromObservations(obs: Observations): MotionSpec {
  const words = cleanWords(obs.words);
  const bounds = [0, ...obs.cuts.filter((c) => c > 0 && c < obs.duration), obs.duration];
  const shots: Shot[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [from, to] = [bounds[i], bounds[i + 1]];
    const inside = words.filter((w) => {
      const mid = (w.start + w.settled) / 2;
      return mid >= from && mid < to;
    });
    const groups = groupByTime(inside);
    if (!groups.length || !isKineticText(groups, obs.height)) {
      shots.push({
        kind: "placeholder",
        id: `shot-${shots.length + 1}`,
        start: round(from),
        end: round(to),
        background: at(obs.backgrounds, (from + to) / 2),
        label: groups.length ? "interface" : "",
      });
      continue;
    }
    groups.forEach((g, k) => {
      const start = k === 0 ? from : Math.max(...groups[k - 1].map((w) => w.end));
      const end =
        k === groups.length - 1 ? to : Math.max(...g.map((w) => w.end));
      shots.push(
        textShot(
          `shot-${shots.length + 1}`,
          g,
          obs.rules,
          obs,
          start,
          Math.max(end, start + 0.1),
          k === groups.length - 1 ? "cut" : "blur",
        ),
      );
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
