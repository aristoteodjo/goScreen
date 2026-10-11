import { z } from "zod";
import { SOURCE_END } from "./sequence";
import { MIC_ASSET } from "./soundtrack";
import type {
  CameraEdit,
  CaptureMode,
  EditState,
  RecordedLayer,
  RecordedPointer,
  RecordingClip,
} from "./types";

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

const size = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const layerSchema = z.object({
  instanceId: z.string(),
  deviceId: z.string(),
  colorId: z.string(),
  orientation: z.enum(["portrait", "landscape"]),
  screen: size,
  source: z.enum(["web", "android"]),
  rotation: z.number().catch(0),
  rects: z.array(
    z.object({
      t: z.number(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
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

const cameraSchema = z.object({
  visible: z.boolean(),
  layout: z.enum(["overlay", "split"]),
  corner: z.number().int().min(0).max(8),
  size: z.number().min(0.08).max(0.6),
  shape: z.enum(["rounded", "circle", "square"]),
  mirror: z.boolean(),
});

// v3: each device screen is a layer of the captured region.
const v3Schema = z.object({
  version: z.literal(3),
  mode: z.enum(["scene", "canvas", "device"]),
  capture: size,
  layers: z.array(layerSchema),
  pointers: z.array(pointerSchema),
  media: mediaSchema.optional(),
  // Stretches recorded while paused (source seconds): cut out on first open.
  pauses: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .optional()
    .catch([]),
  // The webcam bubble as placed in the studio during the take.
  camera: cameraSchema.nullable().optional().catch(null),
  // Site tour: one chapter per page, in source seconds.
  chapters: z
    .array(
      z.object({
        url: z.string(),
        start: z.number().min(0),
        end: z.number().min(0),
        // Scenario takes: what the scene shows, written as it is recorded.
        caption: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch([]),
});

// v1 files (before the editor existed) logged raw bridge events in iframe
// coordinates only; they carry no stage positions to replay.
const v1Schema = z.object({ version: z.literal(1) }).passthrough();

const v2Schema = z.object({
  version: z.literal(2),
  stage: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  pointers: z.array(pointerSchema),
});

export type Chapter = {
  url: string;
  start: number;
  end: number;
  caption?: string;
};

export type RecordingFile = {
  stage: { width: number; height: number } | null;
  mode: CaptureMode | null;
  layers: RecordedLayer[];
  pointers: RecordedPointer[];
  // Camera/mic start relative to the first screen frame.
  mediaOffset: number;
  camera: CameraEdit | null;
  pauses: { start: number; end: number }[];
  chapters: Chapter[];
};

export const EMPTY_RECORDING: RecordingFile = {
  stage: null,
  mode: null,
  layers: [],
  pointers: [],
  mediaOffset: 0,
  camera: null,
  pauses: [],
  chapters: [],
};

const ordered = (pointers: RecordedPointer[]) =>
  pointers.filter((p) => p.t >= 0).sort((a, b) => a.t - b.t);

export function parseRecordingFile(json: unknown): RecordingFile {
  const v3 = v3Schema.safeParse(json);
  if (v3.success) {
    const layers = v3.data.layers.map((l) => ({
      ...l,
      rects: [...l.rects].sort((a, b) => a.t - b.t),
    }));
    return {
      stage: v3.data.capture,
      mode: v3.data.mode,
      layers,
      pointers: ordered(v3.data.pointers),
      mediaOffset: (v3.data.media?.offsetMs ?? 0) / 1000,
      camera: v3.data.camera ?? null,
      pauses: v3.data.pauses ?? [],
      chapters: v3.data.chapters ?? [],
    };
  }
  const v2 = v2Schema.safeParse(json);
  if (v2.success) {
    return {
      stage: v2.data.stage,
      mode: null,
      layers: [],
      pointers: ordered(v2.data.pointers),
      mediaOffset: 0,
      camera: null,
      pauses: [],
      chapters: [],
    };
  }
  if (v1Schema.safeParse(json).success) return EMPTY_RECORDING;
  throw new Error("Unrecognised interactions file.");
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The whole recording as one clip: what a fresh edit starts from. */
export function fullClip(
  id = "clip-1",
  start = 0,
  end = SOURCE_END,
): RecordingClip {
  return {
    id,
    kind: "recording",
    in: start,
    out: end,
    speed: 1,
    muted: false,
    cameraHidden: false,
    transition: null,
  };
}

export const DEFAULT_EDIT: EditState = {
  version: 2,
  aspect: "auto",
  background: { kind: "gradient", from: "#1e2a78", to: "#ff6f91", angle: 160 },
  padding: 0.08,
  radius: 18,
  shadow: 0.6,
  clips: [fullClip()],
  overlays: [],
  audio: [],
  assets: [],
  zooms: [],
  touch: { style: "ring", color: "#ffffff", size: 44 },
  cursor: { visible: true, size: 28 },
  sound: { clicks: false, volume: 0.6 },
  layers: null,
  camera: {
    visible: true,
    layout: "overlay",
    corner: 8,
    size: 0.22,
    shape: "rounded",
    mirror: true,
  },
  mic: { volume: 1 },
  tracks: { hidden: [], muted: [], micMuted: false },
};

/** An array where each bad item is dropped alone instead of failing the whole list. */
function lenient<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .transform((items) =>
      items.flatMap((raw) => {
        const r = item.safeParse(raw);
        return r.success ? [r.data as z.infer<T>] : [];
      }),
    )
    .catch([]);
}

const decorSchema = z
  .array(
    z.object({
      x: z.number().min(-1).max(2),
      y: z.number().min(-1).max(2),
      r: z.number().positive().max(3),
      color,
      opacity: z.number().min(0).max(1),
    }),
  )
  .max(8)
  .optional()
  .catch(undefined);

const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("color"), value: color, decor: decorSchema }),
  z.object({
    kind: z.literal("gradient"),
    from: color,
    to: color,
    angle: z.number(),
    decor: decorSchema,
  }),
]);

const animation = z
  .enum([
    "none",
    "fade",
    "slide-up",
    "slide-left",
    "pop",
    "spring",
    "typewriter",
    "words",
    "wipe",
  ])
  .catch("fade");
const id = z.string().min(1);
const unit = z.number().min(0).max(1);

const transitionSchema = z
  .object({
    kind: z.enum(["fade", "dip", "slide-left", "slide-up", "zoom", "wipe"]),
    duration: z.number().min(0.1).max(5),
  })
  .nullable()
  .catch(null);

const recordingClipSchema = z.object({
  id,
  kind: z.literal("recording"),
  transition: transitionSchema,
  in: z.number().min(0),
  out: z.number().positive(),
  speed: z.number().min(0.1).max(16),
  muted: z.boolean().catch(false),
  cameraHidden: z.boolean().catch(false),
});

const slideClipSchema = z.object({
  id,
  kind: z.literal("slide"),
  transition: transitionSchema,
  duration: z.number().positive(),
  background: backgroundSchema.catch(DEFAULT_EDIT.background),
  title: z.string().catch(""),
  subtitle: z.string().catch(""),
  color: color.catch("#ffffff"),
  font: z.string().catch("Inter"),
  animation,
  layout: z.enum(["center", "left"]).optional().catch(undefined),
  eyebrow: z.string().optional().catch(undefined),
  brand: z.string().optional().catch(undefined),
  accent: color.optional().catch(undefined),
  muted: color.optional().catch(undefined),
});

const easeSchema = z.union([
  z.enum([
    "linear",
    "hold",
    "in",
    "out",
    "in-out",
    "back",
    "elastic",
    "spring",
  ]),
  z.object({
    bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
]);

const keyframeSchema = z.object({
  t: z.number().min(0),
  value: z.number(),
  ease: easeSchema.catch("in-out"),
});

const track = lenient(keyframeSchema).optional();

// Keyframes per property; a bad key is dropped alone.
const keyframesSchema = z
  .object({
    x: track,
    y: track,
    scale: track,
    rotation: track,
    opacity: track,
    blur: track,
  })
  .optional()
  .catch(undefined);

const unitStateSchema = z.object({
  opacity: unit,
  dx: z.number(),
  dy: z.number(),
  scale: z.number().min(0).max(10),
  rotation: z.number(),
  blur: z.number().min(0).max(0.2),
});

const animatorSchema = z
  .object({
    unit: z.enum(["char", "word", "line"]),
    order: z.enum(["forward", "reverse", "center", "random"]),
    stagger: z.number().min(0).max(5),
    duration: z.number().min(0).max(10),
    ease: easeSchema.catch("out"),
    from: unitStateSchema,
    exit: z.boolean().catch(false),
  })
  .nullable()
  .optional()
  .catch(null);

const overlayBase = {
  id,
  lane: z.number().int().min(0).max(20),
  start: z.number().min(0),
  duration: z.number().positive(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().catch(0),
  opacity: unit.catch(1),
  enter: animation,
  exit: animation,
  motion: z.number().min(0).max(5).catch(0.4),
  keyframes: keyframesSchema,
};

const overlaySchema = z.discriminatedUnion("kind", [
  z.object({
    ...overlayBase,
    kind: z.literal("text"),
    text: z.string(),
    style: z.object({
      font: z.string(),
      size: z.number().positive().max(1),
      weight: z.number().min(100).max(900),
      color,
      align: z.enum(["left", "center", "right"]),
      background: color.nullable(),
      bullet: color.nullable().optional().catch(undefined),
      tracking: z.number().min(0).max(1).optional().catch(undefined),
    }),
    animator: animatorSchema,
  }),
  z.object({
    ...overlayBase,
    kind: z.literal("image"),
    asset: id,
    radius: z.number().min(0).catch(0),
  }),
  z.object({
    ...overlayBase,
    kind: z.literal("video"),
    asset: id,
    in: z.number().min(0),
    volume: z.number().min(0).max(2).catch(1),
    radius: z.number().min(0).catch(0),
    source: z
      .object({
        block: z.string().min(1),
        props: z.record(z.string(), z.union([z.string(), z.number()])),
      })
      .optional()
      .catch(undefined),
  }),
  z.object({
    ...overlayBase,
    kind: z.literal("shape"),
    shape: z.enum(["arrow", "rect", "ellipse", "highlight"]),
    color,
    stroke: z.number().min(0).max(0.1).catch(0.008),
  }),
  z.object({
    ...overlayBase,
    kind: z.literal("blur"),
    mode: z.enum(["blur", "pixelate"]).catch("blur"),
    strength: z.number().min(0.002).max(0.1).catch(0.02),
    radius: z.number().min(0).max(0.5).catch(0.01),
  }),
]);

const audioClipSchema = z.object({
  id,
  lane: z.number().int().min(0).max(20),
  start: z.number().min(0),
  duration: z.number().positive(),
  asset: id,
  in: z.number().min(0),
  volume: z.number().min(0).max(2).catch(1),
  fadeIn: z.number().min(0).catch(0),
  fadeOut: z.number().min(0).catch(0),
});

const assetSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  // A bare file name inside the assets folder: never a path.
  file: z.string().regex(/^[^/\\]+$/),
  duration: z.number().positive().nullable().catch(null),
});

const editSchema = z.object({
  film: z
    .object({
      settings: z.record(z.string(), z.unknown()),
      locale: z.string(),
    })
    .optional()
    .catch(undefined),
  version: z.union([z.literal(1), z.literal(2)]),
  aspect: z
    .enum(["auto", "16:9", "1:1", "4:3", "9:16", "3:4", "4:5"])
    .catch(DEFAULT_EDIT.aspect),
  background: backgroundSchema.catch(DEFAULT_EDIT.background),
  padding: z.number().min(0).max(0.4).catch(DEFAULT_EDIT.padding),
  radius: z.number().min(0).max(120).catch(DEFAULT_EDIT.radius),
  shadow: z.number().min(0).max(1).catch(DEFAULT_EDIT.shadow),
  // v1 kept one trimmed range; v2 has a clip sequence.
  trim: z
    .object({ start: z.number().min(0), end: z.number().positive().nullable() })
    .optional()
    .catch(undefined),
  clips: lenient(
    z.discriminatedUnion("kind", [recordingClipSchema, slideClipSchema]),
  ).optional(),
  overlays: lenient(overlaySchema).optional(),
  audio: lenient(audioClipSchema).optional(),
  assets: lenient(assetSchema).optional(),
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
    .object({
      style: z.enum(["ring", "solid", "none"]),
      color,
      size: z.number().min(12).max(160),
    })
    .catch(DEFAULT_EDIT.touch),
  cursor: z
    .object({ visible: z.boolean(), size: z.number().min(12).max(96) })
    .catch(DEFAULT_EDIT.cursor),
  sound: z
    .object({ clicks: z.boolean(), volume: z.number().min(0).max(1) })
    .catch(DEFAULT_EDIT.sound),
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
        hidden: z.boolean().catch(false),
      }),
    )
    .nullable()
    .catch(null),
  camera: cameraSchema.catch(DEFAULT_EDIT.camera),
  mic: z.object({ volume: z.number().min(0).max(2) }).catch(DEFAULT_EDIT.mic),
  tracks: z
    .object({
      hidden: z.array(z.number().int().min(0)).catch([]),
      muted: z.array(z.number().int().min(0)).catch([]),
      micMuted: z.boolean().catch(false),
    })
    .catch(DEFAULT_EDIT.tracks),
});

/** Saved edits, field by field: one bad field falls back alone. v1 files are upgraded. */
export function parseEditState(json: unknown): EditState | null {
  const parsed = editSchema.safeParse(json);
  if (!parsed.success) return null;
  const {
    trim,
    clips,
    overlays,
    audio,
    assets,
    version: _version,
    ...rest
  } = parsed.data;
  const assetIds = new Set((assets ?? []).map((a) => a.id));
  return {
    ...rest,
    version: 2,
    clips:
      clips && clips.length > 0
        ? clips
        : [fullClip("clip-1", trim?.start ?? 0, trim?.end ?? SOURCE_END)],
    // Media whose file entry is gone cannot be drawn.
    overlays: (overlays ?? []).filter((o) =>
      o.kind === "image" || o.kind === "video" ? assetIds.has(o.asset) : true,
    ),
    audio: (audio ?? []).filter(
      (a) => a.asset === MIC_ASSET || assetIds.has(a.asset),
    ),
    assets: assets ?? [],
  };
}
