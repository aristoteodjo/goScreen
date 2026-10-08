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

// Real origin -> proxy origin, per user agent. Lets in-site navigation
// resolve locally instead of paying a probe round-trip through Rust.
const proxyOrigins = new Map<string, string>();
const cacheKey = (origin: string, userAgent: string, touch: boolean) =>
  `${origin}|${touch ? 1 : 0}|${userAgent}`;

async function proxyOpen(url: string, userAgent: string, touch: boolean): Promise<ProxyTarget> {
  const target = new URL(url);
  const known = proxyOrigins.get(cacheKey(target.origin, userAgent, touch));
  if (known) {
    return { url, proxiedUrl: `${known}${target.pathname}${target.search}${target.hash}` };
  }
  const result = proxyTargetSchema.parse(await invoke("proxy_open", { url, userAgent, touch }));
  proxyOrigins.set(
    cacheKey(new URL(result.url).origin, userAgent, touch),
    new URL(result.proxiedUrl).origin,
  );
  return result;
}

export const ipc = {
  proxyOpen,
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
