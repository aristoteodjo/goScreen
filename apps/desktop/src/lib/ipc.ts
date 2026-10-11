import { brandSchema, sectionSchema } from "@goscreen/campaign";
import type { AudioPiece } from "@goscreen/render-engine";
import { invoke } from "@tauri-apps/api/core";
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
  videoUrl: z.string().url(),
  cameraUrl: z.string().url().nullable(),
  micUrl: z.string().url().nullable(),
  name: z.string(),
  interactions: z.unknown().nullable(),
  edit: z.unknown().nullable(),
  // Asset file name -> local media URL.
  assets: z.record(z.string(), z.string().url()).catch({}),
});

const importedAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  file: z.string().min(1),
  url: z.string().url(),
});
export type ImportedAsset = z.infer<typeof importedAssetSchema>;
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
});
export type VideoEntry = z.infer<typeof videoEntrySchema>;

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
  ) =>
    z
      .string()
      .min(1)
      .parse(
        await invoke("export_finish", { videoPath, clicks, volume, pieces }),
      ),
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
  scenarioCancel: async () => {
    await invoke("scenario_cancel");
  },
  exportCancel: async () => {
    await invoke("export_cancel");
  },
};
