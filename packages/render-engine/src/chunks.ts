import { sceneTimeAt } from "./compose";
import { placeClips, sequenceDuration } from "./sequence";
import type { EditState, MainClip, Overlay, ZoomSegment } from "./types";

// Incremental export: the timeline is cut into chunks of a few seconds and
// each chunk gets a fingerprint of the part of the montage that can change
// its frames. A rendered chunk is kept under its fingerprint; the next export
// only renders the chunks whose fingerprint is new and concatenates the rest.

export const CHUNK_SECONDS = 5;
// Bump when the renderer changes what a frame looks like for the same state.
const RENDER_VERSION = 2;
// Seconds around a chunk whose state still reaches its frames (motion blur,
// zoom ramps, transitions of the next clip).
const MARGIN = 1;

export type ChunkSettings = {
  fps: number;
  longSide: number;
  // The recording's pixel size, which decides the output size with `aspect`.
  source: { width: number; height: number };
};

export type Chunk = {
  index: number;
  // Timeline seconds; `to` is exclusive.
  from: number;
  to: number;
  // First output frame and number of frames.
  frame: number;
  frames: number;
  hash: string;
};

/** JSON with sorted keys, so the same state always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return JSON.stringify(value ?? null);
}

/** FNV-1a, 64 bits, as 16 hex characters. */
export function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) =>
  a0 < b1 && b0 < a1;

/** The source span a recording clip shows between timeline times a and b. */
function sourceSpan(
  clip: Extract<MainClip, { kind: "recording" }>,
  start: number,
  a: number,
  b: number,
): [number, number] {
  const s0 = clip.in + Math.max(0, a - start) * clip.speed;
  const s1 = clip.in + Math.max(0, b - start) * clip.speed;
  return [Math.max(clip.in, s0), Math.min(clip.out, s1)];
}

/** Everything in `edit` that reaches the frames of [from, to). */
export function chunkFingerprint(
  edit: EditState,
  settings: ChunkSettings,
  from: number,
  to: number,
): unknown {
  const a = from - MARGIN;
  const b = to + MARGIN;
  const placed = placeClips(edit.clips);
  const clips = placed
    .filter((p) => overlaps(p.start, p.end, a, b))
    .map((p) => {
      const prev = p.index > 0 ? placed[p.index - 1] : null;
      const spans: [number, number][] = [];
      if (p.clip.kind === "recording")
        spans.push(sourceSpan(p.clip, p.start, a, b));
      return {
        clip: p.clip,
        at: p.start - from,
        // The outgoing still of a transition is the previous clip's last frame.
        before: p.clip.transition && prev ? prev.clip : null,
        scene: sceneTimeAt(edit.clips, Math.max(from, p.start)),
        spans,
      };
    });
  const seen = clips.flatMap((c) => c.spans);
  const zooms: ZoomSegment[] = edit.zooms.filter((z) =>
    seen.some(([s0, s1]) => overlaps(z.start - MARGIN, z.end + MARGIN, s0, s1)),
  );
  const hidden = edit.tracks.hidden;
  const overlays = edit.overlays
    .filter((o) => !hidden.includes(o.lane))
    .filter((o) => overlaps(o.start, o.start + o.duration, a, b))
    .map((o): { overlay: Overlay; at: number } => ({ overlay: o, at: o.start - from }));
  return {
    v: RENDER_VERSION,
    settings,
    aspect: edit.aspect,
    background: edit.background,
    padding: edit.padding,
    radius: edit.radius,
    shadow: edit.shadow,
    touch: edit.touch,
    cursor: edit.cursor,
    layers: edit.layers,
    camera: edit.camera,
    screen: edit.screen,
    film: edit.film ?? null,
    clips,
    zooms,
    overlays,
  };
}

/** Cuts the sequence into chunks of `seconds`, each with its fingerprint. */
export function chunkPlan(
  edit: EditState,
  settings: ChunkSettings,
  seconds = CHUNK_SECONDS,
): Chunk[] {
  const fps = Math.max(1, settings.fps);
  const end = sequenceDuration(edit.clips);
  const total = Math.max(1, Math.round(end * fps));
  const per = Math.max(1, Math.round(seconds * fps));
  const out: Chunk[] = [];
  for (let frame = 0, index = 0; frame < total; frame += per, index += 1) {
    const frames = Math.min(per, total - frame);
    const from = frame / fps;
    const to = (frame + frames) / fps;
    out.push({
      index,
      from,
      to,
      frame,
      frames,
      hash: fnv64(stableJson(chunkFingerprint(edit, settings, from, to))),
    });
  }
  return out;
}
