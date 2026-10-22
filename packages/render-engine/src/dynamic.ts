// What keeps a montage alive, after the dark SaaS references (no hard cut,
// the camera travels through one element to reach the next, UI elements
// leave the capture and float in front, everything drifts): a popped-out
// element placed exactly over its rectangle of the glass, and a pass that
// adds a movement wherever nothing changes for too long. Pure functions.

import { applyCamera, DEFAULT_DRIFT } from "./camera";
import { layerPoint } from "./layers";
import { activeOverlays } from "./motion";
import {
  clipAt,
  placeClips,
  sequenceDuration,
  sourceTimeAt,
  timelineTimesOf,
} from "./sequence";
import { placeZoom } from "./timeline";
import { transitionLength } from "./transitions";
import type {
  EditState,
  Frame,
  ImageOverlay,
  Keyframe,
  MainClip,
  Overlay,
  Rect,
  SlideClip,
  ZoomSegment,
} from "./types";

/** A rectangle of a device screen, in fractions of the glass. */
export type GlassRect = { u: number; v: number; w: number; h: number };

/** A pop-out as the studio asks for it. */
export const POP_DEFAULTS = {
  duration: 2.4,
  // How far the element rises: the scale it reaches (1.08 = 8 %).
  lift: 0.08,
  shadow: 0.75,
  radius: 0.012,
};

/**
 * Where a rectangle of the glass sits on the output at this frame, as
 * fractions of the output: the four corners go through the layer's
 * projected quad (so a leaning screen is honoured), then through the zoom
 * camera, and the axis-aligned bounds are kept. `layer` is the device's
 * instance id, or null for a flat recording (one glass, or the content box).
 */
export function popBox(
  frame: Frame,
  layer: string | null,
  rect: GlassRect,
): Rect | null {
  const placed = layer
    ? (frame.layers.find((l) => l.instanceId === layer) ?? null)
    : frame.flat;
  const corners: [number, number][] = [
    [rect.u, rect.v],
    [rect.u + rect.w, rect.v],
    [rect.u + rect.w, rect.v + rect.h],
    [rect.u, rect.v + rect.h],
  ];
  const points = corners.map(([u, v]) => {
    const p = placed
      ? layerPoint(placed, u, v)
      : {
          x: frame.content.x + u * frame.content.width,
          y: frame.content.y + v * frame.content.height,
        };
    return applyCamera(frame.camera, frame.output, p);
  });
  if (layer && !placed) return null;
  const xs = points.map((p) => p.x / frame.output.width);
  const ys = points.map((p) => p.y / frame.output.height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export type PopOutSpec = {
  id: string;
  asset: string;
  lane: number;
  // Timeline seconds.
  start: number;
  duration: number;
  // Where the element sits at `start`, fractions of the output.
  box: Rect;
  lift?: number;
  // Edge glow colour (the film's accent); null for none.
  glow?: string | null;
};

/**
 * The popped-out element: an image layer placed exactly over its box, that
 * rises off the screen (scale 1 -> 1 + lift on the sharp curve, a small
 * move up and towards the centre), keeps drifting a little, carries a soft
 * shadow and an edge glow, and fades at its end. Everything is ordinary
 * keyframes: editable afterwards.
 */
export function popOutOverlay(spec: PopOutSpec): ImageOverlay {
  const lift = spec.lift ?? POP_DEFAULTS.lift;
  const cx = spec.box.x + spec.box.width / 2;
  const cy = spec.box.y + spec.box.height / 2;
  const rise = Math.min(0.55, spec.duration / 3);
  const tail = Math.max(rise, spec.duration - 0.35);
  // A touch towards the centre of the frame and upwards, in fractions.
  const dx = (0.5 - cx) * 0.04;
  const dy = -0.012;
  const sharp = { bezier: [0.1, 0.9, 0.2, 1] as [number, number, number, number] };
  const key = (t: number, value: number, ease: Keyframe["ease"] = "in-out") => ({
    t,
    value,
    ease,
  });
  return {
    id: spec.id,
    kind: "image",
    asset: spec.asset,
    lane: spec.lane,
    start: spec.start,
    duration: spec.duration,
    x: cx,
    y: cy,
    width: spec.box.width,
    height: spec.box.height,
    rotation: 0,
    opacity: 1,
    enter: "none",
    exit: "fade",
    motion: 0.35,
    radius: POP_DEFAULTS.radius,
    shadow: POP_DEFAULTS.shadow,
    glow: spec.glow ?? null,
    keyframes: {
      scale: [
        key(0, 1, sharp),
        key(rise, 1 + lift),
        key(tail, 1 + lift + 0.025, "hold"),
      ],
      x: [key(0, cx, sharp), key(rise, cx + dx), key(tail, cx + dx * 1.4, "hold")],
      y: [key(0, cy, sharp), key(rise, cy + dy), key(tail, cy + dy * 1.5, "hold")],
    },
  };
}

export type EnergizeOptions = {
  // Seconds without a visible change before a movement is added.
  every?: number;
  // Two added effects never sit closer than this.
  minGap?: number;
};

export const ENERGIZE_DEFAULTS = { every: 2, minGap: 0.2 };

export type EnergizeKind =
  | "drift"
  | "zoom"
  | "text-pop"
  | "zoom-through"
  | "card-push";

export type EnergizeChange = {
  // Timeline seconds.
  t: number;
  kind: EnergizeKind;
  // The clip, overlay or zoom the change touches.
  target: string;
  detail: string;
};

/** Timeline instants where something visibly changes, sorted and unique. */
export function changeTimes(edit: EditState): number[] {
  const out = new Set<number>([0]);
  const r = (t: number) => Math.round(t * 1000) / 1000;
  for (const p of placeClips(edit.clips)) {
    out.add(r(p.start));
    if (p.index > 0 && p.clip.transition) {
      const prev = edit.clips[p.index - 1];
      out.add(r(p.start + transitionLength(prev, p.clip)));
    }
  }
  for (const o of edit.overlays) {
    if (edit.tracks.hidden.includes(o.lane)) continue;
    out.add(r(o.start));
    out.add(r(o.start + o.duration));
    for (const keys of Object.values(o.keyframes ?? {}))
      for (const k of keys ?? []) out.add(r(o.start + k.t));
  }
  for (const z of edit.zooms) {
    for (const t of timelineTimesOf(edit.clips, z.start)) out.add(r(t));
    for (const t of timelineTimesOf(edit.clips, z.end)) out.add(r(t));
  }
  const end = sequenceDuration(edit.clips);
  return [...out].filter((t) => t >= 0 && t <= end).sort((a, b) => a - b);
}

const zoomActiveAt = (zooms: ZoomSegment[], s: number) =>
  zooms.some((z) => s > z.start && s < z.end);

/**
 * Keeps a montage moving: wherever nothing changes for more than `every`
 * seconds, one movement is added at that point: a gentle zoom on a
 * recording (following the taps), a pop of a text already on screen, a slow
 * push on a card. Every hard cut becomes a zoom-through, and the camera
 * drift is switched on. Two added effects are never closer than `minGap`.
 * Returns the new montage and what changed, in time order.
 */
export function energize(
  edit: EditState,
  options: EnergizeOptions = {},
): { edit: EditState; changes: EnergizeChange[] } {
  const every = Math.max(0.5, options.every ?? ENERGIZE_DEFAULTS.every);
  const minGap = options.minGap ?? ENERGIZE_DEFAULTS.minGap;
  const changes: EnergizeChange[] = [];
  const added: number[] = [];
  const free = (t: number) => added.every((a) => Math.abs(a - t) >= minGap);
  const take = (c: EnergizeChange) => {
    added.push(c.t);
    changes.push(c);
  };

  let clips: MainClip[] = edit.clips.map((c) => ({ ...c }));
  let overlays: Overlay[] = [...edit.overlays];
  const zooms: ZoomSegment[] = [...edit.zooms];
  let drift = edit.drift;

  if (!drift || (drift.scale === 0 && drift.pan === 0)) {
    drift = DEFAULT_DRIFT;
    take({
      t: 0,
      kind: "drift",
      target: "camera",
      detail: `camera drift on: +${Math.round(DEFAULT_DRIFT.scale * 100)} % push and a ${Math.round(DEFAULT_DRIFT.pan * 1000) / 10} % pan over each scene`,
    });
  }

  // Hard cuts become continuous: the camera dives through the outgoing
  // picture into the next one.
  const placed = placeClips(clips);
  clips = clips.map((c, i) => {
    if (i === 0 || c.transition) return c;
    const prev = clips[i - 1];
    const next = { ...c, transition: { kind: "zoomThrough" as const, duration: 0.5 } };
    if (transitionLength(prev, next) < 0.2) return c;
    take({
      t: placed[i].start,
      kind: "zoom-through",
      target: c.id,
      detail: `cut into ${c.id} replaced by a 0.5 s zoom-through`,
    });
    return next;
  });

  const events = changeTimes({ ...edit, clips, overlays, zooms });
  const end = sequenceDuration(clips);
  const pushed = new Set<string>();
  let zoomCount = 0;

  for (let i = 0; i < events.length; i += 1) {
    const from = events[i];
    const to = events[i + 1] ?? end;
    for (let t = from + every; t < to - 0.3; t += every) {
      if (!free(t)) continue;
      const here = clipAt(clips, t);
      if (!here) break;
      if (here.clip.kind === "slide") {
        if (pushed.has(here.clip.id) || (here.clip.push ?? 1) > 1) continue;
        pushed.add(here.clip.id);
        const push = 1.06;
        clips = clips.map((c) =>
          c.id === here.clip.id ? ({ ...c, push } as SlideClip) : c,
        );
        take({
          t,
          kind: "card-push",
          target: here.clip.id,
          detail: `card ${here.clip.id} pushes in to ${push}× over its length`,
        });
        continue;
      }
      const s = sourceTimeAt(clips, t);
      // A text already on screen can pop again, never twice within 0.6 s.
      const texts = activeOverlays(overlays, t).filter(
        (o) =>
          o.kind === "text" &&
          !(o.keyframes?.scale ?? []).some(
            (k) => Math.abs(o.start + k.t - t) < 0.6,
          ),
      );
      if (s !== null && !zoomActiveAt(zooms, s)) {
        const slot = placeZoom(zooms, s, Number.POSITIVE_INFINITY, 2.6);
        if (slot) {
          const bounded = {
            start: Math.max(slot.start, here.clip.in),
            end: Math.min(slot.end, here.clip.out),
          };
          if (bounded.end - bounded.start >= 0.8) {
            zoomCount += 1;
            const id = `energize-zoom-${zoomCount}`;
            zooms.push({ id, ...bounded, scale: 1.12, focus: null });
            take({
              t,
              kind: "zoom",
              target: id,
              detail: `gentle 1.12× zoom from ${bounded.start.toFixed(2)} s to ${bounded.end.toFixed(2)} s (source)`,
            });
            continue;
          }
        }
      }
      const text = texts[0];
      if (text) {
        const local = t - text.start;
        const pop: Keyframe[] = [
          { t: Math.max(0, local - 0.01), value: 1, ease: "out" },
          { t: local + 0.13, value: 1.04, ease: "in-out" },
          { t: Math.min(text.duration, local + 0.55), value: 1, ease: "hold" },
        ];
        const keys = [...(text.keyframes?.scale ?? []), ...pop].sort(
          (a, b) => a.t - b.t,
        );
        overlays = overlays.map((o) =>
          o.id === text.id
            ? { ...o, keyframes: { ...(o.keyframes ?? {}), scale: keys } }
            : o,
        );
        take({
          t,
          kind: "text-pop",
          target: text.id,
          detail: `text ${text.id} pops by 4 % at ${t.toFixed(2)} s`,
        });
      }
    }
  }

  changes.sort((a, b) => a.t - b.t);
  return { edit: { ...edit, clips, overlays, zooms, drift }, changes };
}
