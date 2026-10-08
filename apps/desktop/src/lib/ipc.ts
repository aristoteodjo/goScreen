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
});
export type RecordingResult = z.infer<typeof recordingResultSchema>;

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

export const ipc = {
  proxyOpen: async (url: string, userAgent: string, touch: boolean) =>
    proxyTargetSchema.parse(
      await invoke("proxy_open", { url, userAgent, touch }),
    ),
  ffmpegStatus: async () => ffmpegStatusSchema.parse(await invoke("ffmpeg_status")),
  recordingStart: async (region: CaptureRegion, fps = 60) =>
    z.string().parse(await invoke("recording_start", { region, fps })),
  recordingStop: async (interactions: unknown) =>
    recordingResultSchema.parse(
      await invoke("recording_stop", { interactions }),
    ),
  screenshot: async (region: CaptureRegion) =>
    z.string().parse(await invoke("screenshot_capture", { region })),
};
