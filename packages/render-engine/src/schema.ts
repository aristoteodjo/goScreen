import { z } from "zod";
import type { CaptureMode, EditState, RecordedLayer, RecordedPointer } from "./types";

const pointerSchema = z.object({
  t: z.number(),
  kind: z.enum(["down", "move", "up"]),
  x: z.number(),
  y: z.number(),
  u: z.number().optional(),
  v: z.number().optional(),
  instanceId: z.string(),
  source: z.enum(["web", "android"]),
});

const size = z.object({ width: z.number().positive(), height: z.number().positive() });

const layerSchema = z.object({
  instanceId: z.string(),
  deviceId: z.string(),
  colorId: z.string(),
  orientation: z.enum(["portrait", "landscape"]),
  screen: size,
  source: z.enum(["web", "android"]),
  rotation: z.number().catch(0),
  rects: z.array(
    z.object({ t: z.number(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  ),
});

const mediaSchema = z
  .object({
    camera: z.string().nullable().catch(null),
    mic: z.string().nullable().catch(null),
    offsetMs: z.number().catch(0),
  })
  .nullable()
  .catch(null);

// v3: each device screen is a layer of the captured region.
const v3Schema = z.object({
  version: z.literal(3),
  mode: z.enum(["scene", "canvas", "device"]),
  capture: size,
  layers: z.array(layerSchema),
  pointers: z.array(pointerSchema),
  media: mediaSchema.optional(),
});

// v1 files (before the editor existed) logged raw bridge events in iframe
// coordinates only; they carry no stage positions to replay.
const v1Schema = z.object({ version: z.literal(1) }).passthrough();

const v2Schema = z.object({
  version: z.literal(2),
  stage: z.object({ width: z.number().positive(), height: z.number().positive() }),
  pointers: z.array(pointerSchema),
});

export type RecordingFile = {
  stage: { width: number; height: number } | null;
  mode: CaptureMode | null;
  layers: RecordedLayer[];
  pointers: RecordedPointer[];
  // Camera/mic start relative to the first screen frame.
  mediaOffset: number;
};

const ordered = (pointers: RecordedPointer[]) => pointers.filter((p) => p.t >= 0).sort((a, b) => a.t - b.t);

export function parseRecordingFile(json: unknown): RecordingFile {
  const v3 = v3Schema.safeParse(json);
  if (v3.success) {
    const layers = v3.data.layers.map((l) => ({ ...l, rects: [...l.rects].sort((a, b) => a.t - b.t) }));
    return {
      stage: v3.data.capture,
      mode: v3.data.mode,
      layers,
      pointers: ordered(v3.data.pointers),
      mediaOffset: (v3.data.media?.offsetMs ?? 0) / 1000,
    };
  }
  const v2 = v2Schema.safeParse(json);
  if (v2.success) {
    return { stage: v2.data.stage, mode: null, layers: [], pointers: ordered(v2.data.pointers), mediaOffset: 0 };
  }
  if (v1Schema.safeParse(json).success) return { stage: null, mode: null, layers: [], pointers: [], mediaOffset: 0 };
  throw new Error("Unrecognised interactions file.");
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const DEFAULT_EDIT: EditState = {
  version: 1,
  aspect: "auto",
  background: { kind: "gradient", from: "#1e2a78", to: "#ff6f91", angle: 160 },
  padding: 0.08,
  radius: 18,
  shadow: 0.6,
  trim: { start: 0, end: null },
  zooms: [],
  touch: { style: "ring", color: "#ffffff", size: 44 },
  sound: { clicks: false, volume: 0.6 },
  layers: null,
  camera: { visible: true, layout: "overlay", corner: 8, size: 0.22, shape: "rounded", mirror: true },
  mic: { volume: 1 },
};

const editSchema = z.object({
  version: z.literal(1),
  aspect: z.enum(["auto", "16:9", "1:1", "4:3", "9:16", "3:4", "4:5"]).catch(DEFAULT_EDIT.aspect),
  background: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("color"), value: color }),
      z.object({ kind: z.literal("gradient"), from: color, to: color, angle: z.number() }),
    ])
    .catch(DEFAULT_EDIT.background),
  padding: z.number().min(0).max(0.4).catch(DEFAULT_EDIT.padding),
  radius: z.number().min(0).max(120).catch(DEFAULT_EDIT.radius),
  shadow: z.number().min(0).max(1).catch(DEFAULT_EDIT.shadow),
  trim: z
    .object({ start: z.number().min(0), end: z.number().positive().nullable() })
    .catch(DEFAULT_EDIT.trim),
  zooms: z
    .array(
      z.object({
        id: z.string(),
        start: z.number().min(0),
        end: z.number().positive(),
        scale: z.number().min(1).max(4),
        focus: z.object({ x: z.number(), y: z.number() }).nullable(),
      }),
    )
    .catch([]),
  touch: z
    .object({ style: z.enum(["ring", "solid", "none"]), color, size: z.number().min(12).max(160) })
    .catch(DEFAULT_EDIT.touch),
  sound: z.object({ clicks: z.boolean(), volume: z.number().min(0).max(1) }).catch(DEFAULT_EDIT.sound),
  layers: z
    .array(
      z.object({
        instanceId: z.string(),
        deviceId: z.string(),
        colorId: z.string(),
        frame: z.boolean(),
        x: z.number(),
        y: z.number(),
        scale: z.number().positive().max(3),
        rotation: z.number().min(-180).max(180),
      }),
    )
    .nullable()
    .catch(null),
  camera: z
    .object({
      visible: z.boolean(),
      layout: z.enum(["overlay", "split"]),
      corner: z.number().int().min(0).max(8),
      size: z.number().min(0.08).max(0.6),
      shape: z.enum(["rounded", "circle", "square"]),
      mirror: z.boolean(),
    })
    .catch(DEFAULT_EDIT.camera),
  mic: z.object({ volume: z.number().min(0).max(2) }).catch(DEFAULT_EDIT.mic),
});

/** Saved edits, field by field: one bad field falls back alone. */
export function parseEditState(json: unknown): EditState | null {
  const parsed = editSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
