import { brandSchema, sectionSchema } from "@goscreen/campaign";
import type { AudioPiece } from "@goscreen/render-engine";
import { invoke } from "@tauri-apps/api/core";
import {
  type WordsFile,
  wordSchema,
  wordsFileSchema,
} from "@goscreen/speech";
import { z } from "zod";

const proxyTargetSchema = z.object({
  proxiedUrl: z.string().url(),
  url: z.string().url(),
});
export type ProxyTarget = z.infer<typeof proxyTargetSchema>;

const recordingResultSchema = z.object({
  videoPath: z.string().min(1),
  interactionsPath: z.string().min(1),
  durationMs: z.number().nonnegative(),
  cameraPath: z.string().nullable(),
  micPath: z.string().nullable(),
  micSilent: z.boolean().catch(false),
});

const captureDeviceSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
});
const captureDevicesSchema = z.object({
  cameras: z.array(captureDeviceSchema),
  microphones: z.array(captureDeviceSchema),
});
export type CaptureDevices = z.infer<typeof captureDevicesSchema>;
export type RecordingResult = z.infer<typeof recordingResultSchema>;

const recordingStartedSchema = z.object({
  videoPath: z.string().min(1),
  companionWarning: z.string().nullable(),
  spawnOffsetMs: z.number().nonnegative(),
});
export type RecordingStarted = z.infer<typeof recordingStartedSchema>;

const openedRecordingSchema = z.object({
  videoPath: z.string().min(1),
  // null: a montage without a recording (`<stem>.edit.json`).
  videoUrl: z.string().url().nullable(),
  cameraUrl: z.string().url().nullable(),
  micUrl: z.string().url().nullable(),
  name: z.string(),
  interactions: z.unknown().nullable(),
  edit: z.unknown().nullable(),
  // Asset file name -> local media URL.
  assets: z.record(z.string(), z.string().url()).catch({}),
});

const versionMetaSchema = z.object({
  id: z.string().min(1),
  at: z.string(),
  author: z.enum(["person", "ai"]),
  command: z.string().optional(),
  message: z.string().optional(),
});

const importedAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  file: z.string().min(1),
  url: z.string().url(),
});
export type ImportedAsset = z.infer<typeof importedAssetSchema>;

/** What `ebur128` hears in a master: integrated LUFS and true peak dBTP. */
const loudnessSchema = z.object({
  integrated: z.number(),
  truePeak: z.number(),
});
export type Loudness = z.infer<typeof loudnessSchema>;
const exportOutputSchema = z.object({
  file: z.string().min(1),
  loudness: loudnessSchema.nullable(),
});
export type ExportOutput = z.infer<typeof exportOutputSchema>;

/** A generated sound: a bed of a style and seed, or one effect. */
export type SoundJob =
  | {
      kind: "music";
      style: string;
      seed: number;
      duration: number;
      payoff: number | null;
    }
  | { kind: "sfx"; sfx: string; level?: "soft" | "full" };
export type OpenedRecording = z.infer<typeof openedRecordingSchema>;

const recordingEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  modifiedMs: z.number(),
  hasInteractions: z.boolean(),
});
export type RecordingEntry = z.infer<typeof recordingEntrySchema>;

const scenarioOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    videoPath: z.string().min(1),
    interactionsPath: z.string().min(1),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("inspected"),
    page: z.record(z.string(), z.unknown()),
  }),
  z.object({
    status: z.literal("simulated"),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("failed"),
    index: z.number().int().nonnegative().nullable(),
    message: z.string(),
    shot: z.string().nullable(),
  }),
]);
export type ScenarioOutcome = z.infer<typeof scenarioOutcomeSchema>;

const ffmpegStatusSchema = z.object({
  available: z.boolean(),
  path: z.string().nullable(),
});

export type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Real origin -> proxy origin, per user agent. Lets in-site navigation
// resolve locally instead of paying a probe round-trip through Rust.
const proxyOrigins = new Map<string, string>();
const cacheKey = (origin: string, userAgent: string, touch: boolean) =>
  `${origin}|${touch ? 1 : 0}|${userAgent}`;

async function proxyOpen(
  url: string,
  userAgent: string,
  touch: boolean,
): Promise<ProxyTarget> {
  const target = new URL(url);
  const known = proxyOrigins.get(cacheKey(target.origin, userAgent, touch));
  if (known) {
    return {
      url,
      proxiedUrl: `${known}${target.pathname}${target.search}${target.hash}`,
    };
  }
  const result = proxyTargetSchema.parse(
    await invoke("proxy_open", { url, userAgent, touch }),
  );
  proxyOrigins.set(
    cacheKey(new URL(result.url).origin, userAgent, touch),
    new URL(result.proxiedUrl).origin,
  );
  return result;
}

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdMs: z.number(),
  modifiedMs: z.number(),
  vsls: z.number().int(),
  videos: z.number().int(),
});
export type ProjectEntry = z.infer<typeof projectSchema>;

const vslEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  modifiedMs: z.number(),
});
export type VslEntry = z.infer<typeof vslEntrySchema>;

const videoEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  modifiedMs: z.number(),
  export: z.boolean(),
  // A montage without a recording (`<id>.edit.json`).
  composition: z.boolean().catch(false),
});
export type VideoEntry = z.infer<typeof videoEntrySchema>;

/** Compositions of a montage (`<stem>.assets/compositions/`) and of its project library. */
export const compositionsIpc = {
  list: async (videoPath: string) =>
    z
      .object({
        video: z.array(z.unknown()),
        library: z.array(z.unknown()),
        project: z.boolean(),
      })
      .parse(await invoke("composition_list", { videoPath })),
  load: async (videoPath: string, id: string) =>
    invoke("composition_load", { videoPath, id }) as Promise<unknown>,
  save: async (
    videoPath: string,
    id: string,
    doc: unknown,
    library = false,
  ) => {
    await invoke("composition_save", { videoPath, id, doc, library });
  },
  delete: async (videoPath: string, id: string, library = false) => {
    await invoke("composition_delete", { videoPath, id, library });
  },
};

export const projectsIpc = {
  list: async () => z.array(projectSchema).parse(await invoke("projects_list")),
  create: async (name: string) =>
    z
      .string()
      .min(1)
      .parse(await invoke("project_create", { name })),
  rename: async (id: string, name: string) => {
    await invoke("project_rename", { id, name });
  },
  duplicate: async (id: string) =>
    z
      .string()
      .min(1)
      .parse(await invoke("project_duplicate", { id })),
  remove: async (id: string) => {
    await invoke("project_delete", { id });
  },
  videos: async (project: string) =>
    z
      .array(videoEntrySchema)
      .parse(await invoke("project_videos", { project })),
  removeVideo: async (project: string, path: string) => {
    await invoke("project_video_delete", { project, path });
  },
  // A montage without a recording; returns its `.edit.json` path.
  newEdit: async (project: string, name: string, edit: unknown) =>
    z
      .string()
      .min(1)
      .parse(await invoke("edit_new", { project, name, edit })),
  vsls: async (project: string) =>
    z.array(vslEntrySchema).parse(await invoke("vsl_list", { project })),
  createVsl: async (project: string, name: string, doc: unknown) =>
    z
      .string()
      .min(1)
      .parse(await invoke("vsl_create", { project, name, doc })),
  loadVsl: async (project: string, vsl: string) =>
    z.unknown().parse(await invoke("vsl_load", { project, vsl })),
  saveVsl: async (project: string, vsl: string, doc: unknown) => {
    await invoke("vsl_save", { project, vsl, doc });
  },
  renameVsl: async (project: string, vsl: string, name: string) => {
    await invoke("vsl_rename", { project, vsl, name });
  },
  duplicateVsl: async (project: string, vsl: string) =>
    z
      .string()
      .min(1)
      .parse(await invoke("vsl_duplicate", { project, vsl })),
  removeVsl: async (project: string, vsl: string) => {
    await invoke("vsl_delete", { project, vsl });
  },
};

const envelopeSchema = z.object({
  dt: z.number().positive(),
  rms: z.array(z.number()),
});

export const ipc = {
  proxyOpen,
  ffmpegStatus: async () =>
    ffmpegStatusSchema.parse(await invoke("ffmpeg_status")),
  recordingStart: async (
    region: CaptureRegion,
    media: { camera: number | null; microphone: number | null },
    fps = 60,
  ) =>
    recordingStartedSchema.parse(
      await invoke("recording_start", { region, fps, ...media }),
    ),
  /** The app macOS asks about for this process (Portly or a terminal in dev). */
  responsibleApp: async () =>
    z.string().parse(await invoke("responsible_app_name")),
  openPrivacySettings: async (pane: "screen" | "camera" | "microphone") => {
    await invoke("open_privacy_settings", { pane });
  },
  sitePages: async (url: string, limit = 30) =>
    z.array(z.string().url()).parse(await invoke("site_pages", { url, limit })),
  siteBrand: async (url: string) =>
    brandSchema.parse(await invoke("site_brand", { url })),
  siteSections: async (url: string) =>
    z.array(sectionSchema).parse(await invoke("site_sections", { url })),
  captureDevices: async () =>
    captureDevicesSchema.parse(await invoke("capture_devices")),
  recordingStop: async (interactions: unknown) =>
    recordingResultSchema.parse(
      await invoke("recording_stop", { interactions }),
    ),
  /** Cuts a take into one recording per device (crop + journal); returns the new videos. */
  recordingSplit: async (
    videoPath: string,
    parts: {
      suffix: string;
      rect: { x: number; y: number; width: number; height: number };
      journal: unknown;
    }[],
  ) =>
    z
      .array(z.string())
      .parse(await invoke("recording_split", { videoPath, parts })),
  screenshot: async (region: CaptureRegion) =>
    z.string().parse(await invoke("screenshot_capture", { region })),
  recordingOpen: async (videoPath: string) =>
    openedRecordingSchema.parse(await invoke("recording_open", { videoPath })),
  recordingsList: async () =>
    z.array(recordingEntrySchema).parse(await invoke("recordings_list")),
  editSave: async (videoPath: string, edit: unknown) => {
    await invoke("edit_save", { videoPath, edit });
  },
  // Durable versions of a montage (`<stem>.versions/`).
  editVersionsList: async (videoPath: string) =>
    z
      .array(versionMetaSchema)
      .parse(await invoke("edit_versions_list", { videoPath })),
  editVersionGet: async (videoPath: string, id: string) =>
    z.unknown().parse(await invoke("edit_version_get", { videoPath, id })),
  editVersionWrite: async (videoPath: string, version: unknown) =>
    versionMetaSchema.parse(
      await invoke("edit_version_write", { videoPath, version }),
    ),
  editVersionDelete: async (videoPath: string, id: string) => {
    await invoke("edit_version_delete", { videoPath, id });
  },
  // The new video's path: the take linked, sidecars and versions copied.
  editDuplicate: async (videoPath: string, name: string | null) =>
    z
      .string()
      .min(1)
      .parse(await invoke("edit_duplicate", { videoPath, name })),
  exportBegin: async (name: string, fps: number) =>
    z
      .string()
      .min(1)
      .parse(await invoke("export_begin", { name, fps })),
  // Raw body: a JPEG goes over IPC as bytes, not as a JSON array.
  exportFrame: async (jpeg: ArrayBuffer) => {
    await invoke("export_frame", new Uint8Array(jpeg));
  },
  exportFinish: async (
    videoPath: string,
    clicks: number[],
    volume: number,
    pieces: AudioPiece[],
    normalize = true,
  ) =>
    exportOutputSchema.parse(
      await invoke("export_finish", {
        videoPath,
        clicks,
        volume,
        pieces,
        normalize,
      }),
    ),
  /** A music bed or a sound effect rendered into the recording's assets. */
  soundRender: async (videoPath: string, job: SoundJob) =>
    z
      .object({
        asset: importedAssetSchema,
        offset: z.number().min(0),
        seconds: z.number().min(0),
      })
      .parse(await invoke("sound_render", { videoPath, job })),
  /** Integrated loudness (LUFS) and true peak (dBTP) of a video or audio file. */
  audioLoudness: async (path: string) =>
    loudnessSchema.parse(await invoke("audio_loudness", { path })),
  /** The take's transcription as written next to it, or null. */
  wordsRead: async (videoPath: string) =>
    (await invoke("words_read", { videoPath })) as unknown,
  /** Writes `<stem>.srt`; returns its path. */
  srtWrite: async (videoPath: string, text: string) =>
    z
      .string()
      .min(1)
      .parse(await invoke("srt_write", { videoPath, text })),
  /** Starts the mic for a voice-over; resolves once sound is recording. */
  voiceOverStart: async (videoPath: string, microphone: string) =>
    z
      .object({ lead: z.number().nonnegative() })
      .parse(await invoke("voiceover_start", { videoPath, microphone })),
  /** Stops the voice-over; returns the cleaned take, added to the assets. */
  voiceOverStop: async () =>
    z
      .object({ asset: importedAssetSchema, silent: z.boolean() })
      .parse(await invoke("voiceover_stop")),
  /** Loudest level the microphone hears in a short listen, in dB. */
  microphoneLevel: async (microphone: string) =>
    z.number().parse(await invoke("microphone_level", { microphone })),
  /** Silent stretches of an asset, in seconds of the file (end null: to the end). */
  audioSilences: async (
    videoPath: string,
    file: string,
    thresholdDb: number,
    minSilence: number,
  ) =>
    z.array(z.object({ start: z.number(), end: z.number().nullable() })).parse(
      await invoke("audio_silences", {
        videoPath,
        file,
        thresholdDb,
        minSilence,
      }),
    ),
  voiceOverCancel: async () => {
    await invoke("voiceover_cancel");
  },
  /** Words of the take's voice by whisper.cpp (raw: not yet snapped to the sound). */
  mediaTranscribe: async (
    videoPath: string,
    options: { model?: string; language?: string } = {},
  ) =>
    z
      .object({
        language: z.string(),
        words: z.array(wordSchema),
        audio: z.string(),
      })
      .parse(
        await invoke("media_transcribe", {
          videoPath,
          model: options.model ?? null,
          language: options.language ?? null,
        }),
      ),
  mediaWordsSave: async (videoPath: string, words: WordsFile) => {
    await invoke("media_words_save", { videoPath, words });
  },
  mediaWordsLoad: async (videoPath: string) =>
    wordsFileSchema
      .nullable()
      .parse(await invoke("media_words_load", { videoPath })),
  /** Loudness every 10 ms of the take's voice; measured and saved. */
  mediaEnvelope: async (videoPath: string) =>
    envelopeSchema.parse(await invoke("media_envelope", { videoPath })),
  mediaEnvelopeLoad: async (videoPath: string) =>
    envelopeSchema
      .nullable()
      .parse(await invoke("media_envelope_load", { videoPath })),
  /** Writes takes.md or qc.md next to the take; returns its path. */
  mediaSidecarWrite: async (
    videoPath: string,
    suffix: "takes.md" | "qc.md",
    content: string,
  ) =>
    z
      .string()
      .parse(
        await invoke("media_sidecar_write", { videoPath, suffix, content }),
      ),
  /** Eyes and face box at each source time, as fractions of the camera frame. */
  mediaFaceEyes: async (videoPath: string, times: number[]) =>
    z
      .array(
        z.object({
          t: z.number(),
          eyes: z.object({ u: z.number(), v: z.number() }).nullable(),
          face: z
            .object({
              u: z.number(),
              v: z.number(),
              w: z.number(),
              h: z.number(),
            })
            .nullable(),
        }),
      )
      .parse(await invoke("media_face_eyes", { videoPath, times })),
  assetImport: async (videoPath: string, source: string) =>
    importedAssetSchema.parse(
      await invoke("asset_import", { videoPath, source }),
    ),
  /** Plays a scenario in a headless browser; progress comes as `scenario-progress` events. */
  scenarioRun: async (
    job: unknown,
    options: { project?: string | null; dry?: boolean } = {},
  ) =>
    scenarioOutcomeSchema.parse(
      await invoke("scenario_run", {
        job,
        project: options.project ?? null,
        dry: options.dry ?? false,
      }),
    ),
  /** Replays, then serves the page live; resolves when the live page closes. */
  liveStart: async (job: unknown, project: string | null) =>
    scenarioOutcomeSchema.parse(
      await invoke("scenario_live", { job, project }),
    ),
  /** Renders a block (HTML composition) to a temp video; returns its path. */
  blockRender: async (job: {
    html: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    transparent: boolean;
    /** The montage whose assets the page may show (http://goscreen.assets/<file>). */
    video?: string;
  }) =>
    z
      .string()
      .min(1)
      .parse(await invoke("block_render", job)),
  /** One still of a block or composition at t seconds, as base64 JPEG. */
  blockFrame: async (job: {
    html: string;
    width: number;
    height: number;
    t: number;
    transparent: boolean;
    video?: string;
  }) =>
    z
      .string()
      .min(1)
      .parse(await invoke("block_frame", job)),
  /** Describes a page (after optional steps) for an AI. */
  siteInspect: async (job: unknown) =>
    scenarioOutcomeSchema.parse(await invoke("site_inspect", { job })),
  controlInfo: async () =>
    z
      .object({
        port: z.number(),
        file: z.string(),
        mcpServer: z.string(),
        cli: z.string(),
        skill: z.string(),
      })
      .nullable()
      .parse(await invoke("control_info")),
  controlReply: async (id: string, answer: unknown) => {
    await invoke("control_reply", { id, answer });
  },
  liveSend: async (command: Record<string, unknown>) => {
    await invoke("scenario_live_send", { command });
  },
  liveStop: async () => {
    await invoke("scenario_live_stop");
  },
  scenarioCancel: async () => {
    await invoke("scenario_cancel");
  },
  exportCancel: async () => {
    await invoke("export_cancel");
  },
  /** Hashes of the chunks already rendered for this recording. */
  renderCacheList: async (videoPath: string) =>
    z.array(z.string()).parse(await invoke("render_cache_list", { videoPath })),
  /** Starts one chunk of an export; frames go through `exportFrame`. */
  chunkBegin: async (videoPath: string, hash: string, fps: number) => {
    await invoke("chunk_begin", { videoPath, hash, fps });
  },
  chunkFinish: async () => {
    await invoke("chunk_finish");
  },
  /** Joins cached chunks in order and mixes the soundtrack; returns the file. */
  exportAssemble: async (
    videoPath: string,
    name: string,
    hashes: string[],
    clicks: number[],
    volume: number,
    pieces: AudioPiece[],
    normalize = true,
  ) =>
    exportOutputSchema.parse(
      await invoke("export_assemble", {
        videoPath,
        name,
        hashes,
        clicks,
        volume,
        pieces,
        normalize,
      }),
    ),
  /** Starts a small, fast draft of `from..to`; returns the file it writes. */
  previewBegin: async (
    videoPath: string,
    from: number,
    to: number,
    fps: number,
    longSide: number,
  ) =>
    z
      .string()
      .min(1)
      .parse(
        await invoke("preview_begin", { videoPath, from, to, fps, longSide }),
      ),
  previewFinish: async () =>
    z
      .string()
      .min(1)
      .parse(await invoke("preview_finish")),
};
