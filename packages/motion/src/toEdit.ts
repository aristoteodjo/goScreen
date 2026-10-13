import {
  type Asset,
  DEFAULT_EDIT,
  type EditState,
  type Keyframe,
  type MainClip,
  type Overlay,
  type PropertyTracks,
  type TextOverlay,
} from "@goscreen/render-engine";
import { colorDistance } from "./derive.ts";
import type { Label, Line, MotionSpec, Shot, Visual, VisualPoint } from "./schema.ts";

// A reproduced video as an edit: every part of the spec becomes a layer the
// editor knows, so it can be changed, reused in another video, or extended
// by an AI with the editor's own commands. Each shot is a slide (its colour);
// over it, the plate and each picture as an image or a video layer moving
// along its measured path, each line of text as a text layer whose words
// come in one after the other, and each counter as a slot the app fills with
// a counter block (rendered there, as blocks are).

/** A counter the app turns into a `stat-counter` block, where it was. */
export type CounterSlot = {
  /** Centre and size, fractions of the frame (as an overlay's box). */
  box: { x: number; y: number; width: number; height: number };
  start: number;
  duration: number;
  value: number;
  color: string;
};

const round = (n: number, k = 10000) => Math.round(n * k) / k;

/** The editor's format closest to the spec's frame, or its own size. */
export function aspectOf(width: number, height: number): EditState["aspect"] {
  const r = width / height;
  const options: [EditState["aspect"], number][] = [
    ["16:9", 16 / 9],
    ["1:1", 1],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["4:5", 4 / 5],
  ];
  const near = options.find(([, v]) => Math.abs(v / r - 1) < 0.01);
  return near ? near[0] : "auto";
}

/** Keyframes of a picture's measured moves (centre and scale), from its start. */
function pathTracks(path: VisualPoint[], start: number): PropertyTracks {
  if (path.length < 2) return {};
  const keys = (pick: (p: VisualPoint) => number): Keyframe[] =>
    path.map((p) => ({ t: round(Math.max(0, p.t - start), 1000), value: round(pick(p)), ease: "linear" }));
  return { x: keys((p) => p.x), y: keys((p) => p.y), scale: keys((p) => p.scale) };
}

/** Fades in and out as opacity keys, over a layer that lasts `duration`. */
function fades(fadeIn: number, fadeOut: number, duration: number): PropertyTracks {
  if (fadeIn <= 0 && fadeOut <= 0) return {};
  const keys: Keyframe[] = [];
  if (fadeIn > 0)
    keys.push({ t: 0, value: 0, ease: "linear" }, { t: round(Math.min(fadeIn, duration), 1000), value: 1, ease: "linear" });
  else keys.push({ t: 0, value: 1, ease: "linear" });
  if (fadeOut > 0) {
    const from = Math.max(keys[keys.length - 1].t, duration - fadeOut);
    keys.push({ t: round(from, 1000), value: 1, ease: "linear" }, { t: round(duration, 1000), value: 0, ease: "linear" });
  }
  return { opacity: keys };
}

/** Lanes, so layers that overlap in time do not share one (the 21st is shared). */
function laneKeeper() {
  const busy: { start: number; end: number }[][] = [];
  return (start: number, end: number) => {
    for (let lane = 0; lane < 20; lane++) {
      const taken = busy[lane] ?? [];
      if (!taken.some((b) => b.start < end && start < b.end)) {
        busy[lane] = [...taken, { start, end }];
        return lane;
      }
    }
    return 20;
  };
}

export function specToEdit(
  spec: MotionSpec,
  /** The reference's files (plates, pictures) imported into the edit, by file name. */
  assets: Map<string, Asset>,
): { edit: EditState; counters: CounterSlot[] } {
  const font = spec.fonts.text.split(",")[0].replace(/['"]/g, "").trim() || "Inter";
  const overlays: Overlay[] = [];
  const counters: CounterSlot[] = [];
  const lane = laneKeeper();
  let n = 0;
  const id = (kind: string) => `${kind}-${++n}`;

  const clips: MainClip[] = spec.shots.map((shot) => ({
    id: `slide-${shot.id}`,
    kind: "slide",
    duration: round(shot.end - shot.start, 1000),
    background: { kind: "color", value: shot.background },
    title: "",
    subtitle: "",
    color: "#ffffff",
    font,
    animation: "none",
    transition: null,
  }));

  const base = (start: number, end: number) => ({
    lane: lane(start, end),
    start: round(start, 1000),
    duration: round(Math.max(0.05, end - start), 1000),
    rotation: 0,
    opacity: 1,
    enter: "none" as const,
    exit: "none" as const,
    motion: 0,
  });

  const addVisual = (v: Visual, shot: Shot) => {
    const asset = assets.get(v.src);
    if (!asset) return;
    const start = Math.max(v.at, shot.start);
    const end = Math.min(v.until, shot.end);
    if (end <= start) return;
    const keyframes = { ...pathTracks(v.path, start), ...fades(v.at >= shot.start ? v.fadeIn : 0, v.fadeOut, end - start) };
    const box = { x: round(v.x + v.w / 2), y: round(v.y + v.h / 2), width: round(v.w), height: round(v.h) };
    if (v.kind === "clip")
      overlays.push({ id: id("clip"), kind: "video", ...base(start, end), ...box, keyframes, asset: asset.id, in: round(start - v.at, 1000), volume: 0, radius: 0 });
    else overlays.push({ id: id("picture"), kind: "image", ...base(start, end), ...box, keyframes, asset: asset.id, radius: 0 });
  };

  const text = (
    words: string,
    left: number,
    right: number,
    baseline: number,
    size: number,
    color: string,
    weight: number,
    start: number,
    end: number,
    extra: Partial<TextOverlay> = {},
  ): TextOverlay => ({
    id: id("text"),
    kind: "text",
    ...base(start, end),
    x: round(left + (right - left) / 2),
    // The editor places a line by its centre: a little above the baseline.
    y: round(baseline - size * 0.36),
    width: round(Math.max(0.02, right - left) * 1.04),
    height: round(size * 1.3),
    text: words,
    style: { font, size: round(size * 1.2), weight, color, align: "left", background: null },
    ...extra,
  });

  const addCounter = (value: number, x: number, w: number, baseline: number, size: number, color: string, start: number, end: number) =>
    counters.push({
      box: { x: round(x + w / 2), y: round(baseline - size * 0.36), width: round(Math.max(w * 1.6, size)), height: round(size * 1.6) },
      start: round(start, 1000),
      duration: round(Math.max(0.1, end - start), 1000),
      value,
      color,
    });

  const addLine = (shot: Extract<Shot, { kind: "text" }>, line: Line, index: number) => {
    const size = line.size ?? shot.size;
    const baseline = line.y ?? shot.y - (shot.lines.length - 1 - index) * shot.lineHeight * shot.size;
    const end = shot.end;
    // Runs of words of one colour: one text layer each, so the accent stays.
    let run: typeof line.words = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      const left = first.x ?? shot.x;
      const right = last.x !== undefined && last.w !== undefined ? last.x + last.w : left + run.join(" ").length * size * 0.5;
      const color = first.accent ? shot.accent : (first.color ?? shot.ink);
      const steps = run.slice(1).map((w, i) => w.at - run[i].at);
      const stagger = steps.length ? Math.max(0, steps.reduce((a, b) => a + b, 0) / steps.length) : 0;
      overlays.push(
        text(run.map((w) => w.text).join(" "), left, right, baseline, size, color, shot.weight, Math.max(shot.start, first.at), end, {
          animator: {
            unit: "word",
            order: "forward",
            stagger: round(stagger, 1000),
            duration: shot.enter.duration,
            ease: { bezier: shot.enter.ease },
            from: { opacity: 0, dx: 0, dy: shot.enter.y, scale: 1, rotation: 0, blur: round(shot.enter.blur * size) },
            exit: false,
          },
        }),
      );
      run = [];
    };
    for (const w of line.words) {
      if (w.count) {
        flush();
        const x = w.x ?? shot.x;
        addCounter(Number(w.text), x, w.w ?? size, baseline, size, w.color ?? shot.ink, Math.max(shot.start, w.count.start), end);
        continue;
      }
      // One layer per run of words that look alike: accent, or an ink close
      // enough (OCR measures each word a few levels apart).
      const inkOf = (x: (typeof line.words)[number]) => (x.accent ? shot.accent : (x.color ?? shot.ink));
      if (run.length && (w.accent !== run[0].accent || colorDistance(inkOf(w), inkOf(run[0])) > 0.12)) flush();
      run.push(w);
    }
    flush();
    if (shot.underline && index === shot.lines.length - 1) {
      const u = shot.underline;
      const left = u.x ?? shot.x;
      const right = Math.max(...line.words.map((w) => (w.x ?? shot.x) + (w.w ?? 0)), left + 0.05);
      const y = baseline + u.offset * size;
      overlays.push({
        id: id("underline"),
        kind: "shape",
        ...base(Math.max(shot.start, u.at), end),
        x: round(left + (right - left) / 2),
        y: round(y),
        width: round(right - left),
        height: round(Math.max(0.002, u.thickness * size)),
        shape: "rect",
        color: shot.accent,
        stroke: round(Math.max(0.001, (u.thickness * size) / 2), 10000),
      });
    }
  };

  const addLabel = (l: Label, shot: Shot) => {
    const start = Math.max(shot.start, l.at);
    const end = Math.min(shot.end, l.until);
    if (end <= start) return;
    if (l.count) {
      addCounter(Number(l.text), l.x, l.w ?? l.size, l.y, l.size, l.color, Math.max(shot.start, l.count.start), end);
      return;
    }
    const right = l.x + (l.w ?? l.text.length * l.size * 0.5);
    const layer = text(l.text, l.x, right, l.y, l.size, l.color, l.weight, start, end);
    layer.keyframes = { ...pathTracks(l.path, start), ...fades(l.fadeIn, 0, end - start) };
    overlays.push(layer);
  };

  for (const shot of spec.shots) {
    const plate = shot.plate ? assets.get(shot.plate) : undefined;
    if (plate)
      overlays.push({ id: id("plate"), kind: "image", ...base(shot.start, shot.end), x: 0.5, y: 0.5, width: 1, height: 1, asset: plate.id, radius: 0 });
    for (const v of shot.visuals) addVisual(v, shot);
    if (shot.kind === "text") for (const [i, line] of shot.lines.entries()) addLine(shot, line, i);
    else for (const l of shot.labels) addLabel(l, shot);
  }

  const used = new Set(overlays.flatMap((o) => ("asset" in o ? [o.asset] : [])));
  const edit: EditState = {
    ...DEFAULT_EDIT,
    aspect: aspectOf(spec.width, spec.height),
    background: { kind: "color", value: spec.shots[0]?.background ?? "#000000" },
    padding: 0,
    radius: 0,
    shadow: 0,
    clips,
    overlays,
    assets: [...assets.values()].filter((a) => used.has(a.id)),
    cursor: { visible: false, size: DEFAULT_EDIT.cursor.size },
  };
  return { edit, counters };
}

