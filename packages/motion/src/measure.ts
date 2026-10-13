import { cleanWords, colorDistance, drawnWords, visualsFor } from "./derive.ts";
import type { Observations, ObservedWord } from "./observations.ts";
import type { MotionSpec, Visual } from "./schema.ts";

// How close a rendering is to its reference, shot by shot. Both videos go
// through the same analyser, so the comparison is between like and like:
// the words OCR reads in each, where, when and in what colour, and the
// pictures (everything that is not a word) at the same place and time.

export type ShotMeasure = {
  id: string;
  kind: "text" | "placeholder";
  /** Words of the reference in this shot, and of the rendering. */
  refWords: number;
  outWords: number;
  /** Share of the reference's words found in the rendering (0..1). */
  recall: number;
  /** Share of the rendering's words that are in the reference (0..1). */
  precision: number;
  /** Median gap between when a word comes in, in seconds. */
  timing: number;
  /** Median distance between word positions, in frame heights. */
  position: number;
  /** Relative difference of text height (0 = same size). */
  size: number;
  /** Median colour distance of the words (0..1). */
  color: number;
  /** Pictures of the reference in this shot, and how many the rendering shows. */
  refVisuals: number;
  /** Share of the area of the reference's pictures the rendering's take too (0..1, 1 if none). */
  visuals: number;
  /**
   * How alike the frames look, cell by cell, colour included (0..1); null
   * when either side was measured without its small pictures.
   */
  pixels: number | null;
};

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * How alike a shot looks in the reference and the rendering: their small
 * pictures at the same moments, cell by cell. A cell counts fully when its
 * colour is the same, not at all past a gap of 48 (out of 255) per channel.
 */
export function lookAlike(ref: Observations, out: Observations, start: number, end: number): number | null {
  const a = ref.thumbs;
  const b = out.thumbs;
  if (!a || !b || a.cols !== b.cols || a.rows !== b.rows) return null;
  let sum = 0;
  let n = 0;
  for (const f of a.frames) {
    if (f.t < start || f.t >= end) continue;
    const g = b.frames.reduce<(typeof b.frames)[number] | null>(
      (best, x) => (!best || Math.abs(x.t - f.t) < Math.abs(best.t - f.t) ? x : best),
      null,
    );
    if (!g || Math.abs(g.t - f.t) > 0.13) continue;
    const p = bytesOf(f.rgb);
    const q = bytesOf(g.rgb);
    for (let i = 0; i + 2 < p.length && i + 2 < q.length; i += 3) {
      const d = (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
      sum += Math.max(0, 1 - d / 48);
      n++;
    }
  }
  return n ? sum / n : null;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const inShot = (w: ObservedWord, start: number, end: number) => {
  const mid = (w.start + w.settled) / 2;
  return mid >= start && mid < end;
};

/** Cells of a grid over the frame that the pictures cover at time `t`. */
function coverage(visuals: Visual[], t: number, cols = 96, rows = 54): Set<number> {
  const on = new Set<number>();
  for (const v of visuals) {
    if (t < v.at || t >= v.until) continue;
    const x0 = Math.max(0, Math.floor(v.x * cols));
    const x1 = Math.min(cols, Math.ceil((v.x + v.w) * cols));
    const y0 = Math.max(0, Math.floor(v.y * rows));
    const y1 = Math.min(rows, Math.ceil((v.y + v.h) * rows));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on.add(y * cols + x);
  }
  return on;
}

/**
 * The share of the area the reference's pictures take in a shot that the
 * rendering's pictures take too, every quarter of a second: an area, not a
 * count, so a logo found as 16 pieces in one and 6 in the other is alike.
 * Both go through `visualsFor`, so the text of a text shot is left out alike.
 */
function visualRecall(ref: Observations, out: Observations, start: number, end: number, text: boolean) {
  const words = (o: Observations) =>
    text ? drawnWords(cleanWords(o.words)).filter((w) => inShot(w, start, end)) : null;
  // The rendering is not cut out, so its pictures have no file: name them.
  const named = { ...out, visuals: out.visuals.map((v) => ({ ...v, image: v.image ?? "render" })) };
  const a = visualsFor(ref, start, end, words(ref));
  const b = visualsFor(named, start, end, words(named));
  let total = 0;
  let found = 0;
  for (let t = start + 0.125; t < end; t += 0.25) {
    const want = coverage(a, t);
    const got = coverage(b, t);
    total += want.size;
    for (const c of want) if (got.has(c)) found++;
  }
  return { refVisuals: a.length, visuals: total ? found / total : 1 };
}

/** Measures every shot of `spec` between the reference and the rendering. */
export function measureShots(
  spec: MotionSpec,
  ref: Observations,
  out: Observations,
): ShotMeasure[] {
  const H = ref.height;
  // The rendering may be smaller than the reference: compare in fractions.
  const k = ref.height / out.height;
  return spec.shots.map((shot): ShotMeasure => {
    const a = ref.words.filter(
      (w) => w.seen >= 2 && inShot(w, shot.start, shot.end),
    );
    const b = out.words.filter(
      (w) => w.seen >= 2 && inShot(w, shot.start, shot.end),
    );
    const used = new Set<ObservedWord>();
    const pairs: [ObservedWord, ObservedWord][] = [];
    for (const w of a) {
      const match = b
        .filter((o) => !used.has(o) && norm(o.text) === norm(w.text))
        .sort(
          (x, y) => Math.abs(x.start - w.start) - Math.abs(y.start - w.start),
        )[0];
      if (match) {
        used.add(match);
        pairs.push([w, match]);
      }
    }
    const centre = (w: ObservedWord, s: number) => [
      (w.box.x + w.box.w / 2) * s,
      (w.box.y + w.box.h / 2) * s,
    ];
    return {
      id: shot.id,
      kind: shot.kind,
      ...visualRecall(ref, out, shot.start, shot.end, shot.kind === "text"),
      pixels: lookAlike(ref, out, shot.start, shot.end),
      refWords: a.length,
      outWords: b.length,
      recall: a.length ? pairs.length / a.length : 1,
      precision: b.length ? pairs.length / b.length : 1,
      timing: median(pairs.map(([x, y]) => Math.abs(x.start - y.start))),
      position: median(
        pairs.map(([x, y]) => {
          const [p, q] = [centre(x, 1), centre(y, k)];
          return Math.hypot(p[0] - q[0], p[1] - q[1]) / H;
        }),
      ),
      size: pairs.length
        ? Math.abs(1 - median(pairs.map(([x, y]) => (y.box.h * k) / x.box.h)))
        : 1,
      color: median(
        pairs
          .filter(([x, y]) => x.color && y.color)
          .map(([x, y]) => colorDistance(x.color as string, y.color as string)),
      ),
    };
  });
}

/**
 * One score per shot, 0 (nothing alike) to 1 (indistinguishable): what
 * « faithful » means. The loop keeps correcting a shot until it passes
 * `FIDELITY_PASS`.
 */
export function fidelity(m: ShotMeasure): number {
  // Never more faithful than it looks: the measures below read words and
  // boxes, the frames themselves say whether the two are alike.
  return Math.min(m.pixels ?? 1, measured(m));
}

function measured(m: ShotMeasure): number {
  const visuals = m.visuals;
  // A shot of pictures (an interface, a logo) is judged on its pictures.
  if (m.kind === "placeholder") return visuals;
  // TODO(you): weigh the measures. Each one below is turned into 0..1, where
  // 1 is perfect; decide how much each matters and how harsh each is.
  const text = (m.recall + m.precision) / 2;
  const timing = Math.max(0, 1 - m.timing / 0.3);
  const position = Math.max(0, 1 - m.position / 0.05);
  const size = Math.max(0, 1 - m.size / 0.25);
  const color = Math.max(0, 1 - m.color / 0.2);
  return (text + timing + position + size + color) / 5;
}

export const FIDELITY_PASS = 0.85;
