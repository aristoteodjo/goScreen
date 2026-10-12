import { cleanWords, colorDistance, visualsFor } from "./derive.ts";
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
  /** Share of the reference's pictures found in the rendering (0..1, 1 if none). */
  visuals: number;
};

const iou = (a: Visual, b: Visual) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h + b.w * b.h - x * y || 1);
};

/**
 * The share of the reference's pictures in a shot that the rendering shows
 * at about the same place (in fractions, so sizes may differ) and time.
 * Both go through `visualsFor`, so the text of a text shot is left out alike.
 */
function visualRecall(
  ref: Observations,
  out: Observations,
  start: number,
  end: number,
  text: boolean,
) {
  const words = (o: Observations) =>
    text ? cleanWords(o.words).filter((w) => inShot(w, start, end)) : null;
  // The rendering is not cut out, so its pictures have no file: name them.
  const named = {
    ...out,
    visuals: out.visuals.map((v) => ({ ...v, image: v.image ?? "render" })),
  };
  const a = visualsFor(ref, start, end, words(ref));
  const b = visualsFor(named, start, end, words(named));
  const found = a.filter((v) =>
    b.some(
      (o) =>
        iou(v, o) > 0.4 && Math.min(v.until, o.until) > Math.max(v.at, o.at),
    ),
  );
  return {
    refVisuals: a.length,
    visuals: a.length ? found.length / a.length : 1,
  };
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
