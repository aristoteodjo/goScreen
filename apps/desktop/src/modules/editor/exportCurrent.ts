import type { EditState } from "@goscreen/render-engine";
import { filmSchema, applyFilm } from "@goscreen/scenario";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { router } from "@/lib/router";
import { openPlace } from "@/modules/tabs/tabs";
import { exportVideo, load, release, seek } from "./exportVideo";
import { loadImage } from "./media";
import { drawAt } from "./render";
import { outputSize, sourceTimeAt } from "@goscreen/render-engine";
import { assetUrl, currentTimeline, player, useSession } from "./session";
import { useEdit } from "./store";

// Exports of the open montage that run without the export dialog: from the
// AI, and in batches of formats (Remotion-style variants of one film).

export const RESOLUTIONS = { "720": 1280, "1080": 1920, "2160": 3840 } as const;
export type Resolution = keyof typeof RESOLUTIONS;
const STALL_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running: AbortController | null = null;

export const exportRunning = () => running !== null;

/** Stops the export in progress; a stuck one no longer blocks the next. */
export async function stopExport() {
  if (!running) return false;
  running.abort();
  running = null;
  await ipc.exportCancel().catch(() => {});
  return true;
}

/** Opens a video in the editor, in front (WebKit stops hidden media). */
export async function openForExport(video: string) {
  const win = getCurrentWindow();
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
  openPlace({ to: "/editor", search: { video } });
  await router.load();
  const until = Date.now() + 30_000;
  while (!(useSession.getState().videoPath === video && currentTimeline())) {
    if (Date.now() > until) throw new Error("The video did not load.");
    await sleep(200);
  }
  await sleep(500);
}

/** Exports the open montage (or `edit`) to MP4; returns the file. */
export async function exportCurrent(
  o: { resolution: Resolution; fps: number; label?: string },
  edit: EditState = useEdit.getState().edit,
): Promise<string> {
  if (running) throw new Error("An export is already running.");
  const s = useSession.getState();
  const timeline = currentTimeline();
  if (!s.videoUrl || !timeline) throw new Error("The video is not loaded.");
  player.pause();
  running = new AbortController();
  const label = o.label ?? "Exporting";
  const progress = toast.loading(`${label}… 0%`);
  let shown = 0;
  let lastMove = Date.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastMove < STALL_MS) return;
      void stopExport();
      reject(
        new Error(
          "The export does not move: bring the goScreen window to the front (not minimised, not hidden), then try again.",
        ),
      );
    }, 1000);
  });
  try {
    const path = await Promise.race([
      stalled,
      exportVideo({
        edit,
        timeline,
        videoUrl: s.videoUrl,
        videoPath: s.videoPath,
        cameraUrl: s.cameraUrl,
        mediaOffset: s.mediaOffset,
        hasMic: s.micUrl !== null,
        assetUrl: (a) => assetUrl(edit, a),
        name: s.name,
        longSide: RESOLUTIONS[o.resolution],
        fps: o.fps,
        signal: running.signal,
        onProgress: (done) => {
          lastMove = Date.now();
          const pct = Math.round(done * 100);
          if (pct === shown) return;
          shown = pct;
          toast.loading(`${label}… ${pct}%`, { id: progress });
        },
      }),
    ]);
    toast.success(`${label}: done`, { id: progress });
    return path;
  } catch (e) {
    toast.error(`${label}: stopped`, {
      id: progress,
      description: e instanceof Error ? e.message : String(e),
    });
    throw e;
  } finally {
    clearInterval(watchdog);
    running = null;
  }
}

/**
 * One frame of the open montage at timeline time t, drawn by the export
 * renderer, as a JPEG data URL: what the AI (or a test) looks at without
 * exporting. Reports how long the draw took and any error it threw.
 */
export async function renderFrameAt(
  t: number,
  longSide = 960,
): Promise<{ ms: number; width: number; height: number; jpeg: string }> {
  const s = useSession.getState();
  const timeline = currentTimeline();
  if (!s.videoUrl || !timeline) throw new Error("The video is not loaded.");
  const edit = useEdit.getState().edit;
  const video = await load(s.videoUrl);
  const camera =
    s.cameraUrl && edit.camera.visible
      ? await load(s.cameraUrl).catch(() => null)
      : null;
  const media = new Map<string, HTMLImageElement | HTMLVideoElement>();
  for (const o of edit.overlays) {
    if (o.kind !== "image" && o.kind !== "video") continue;
    // Only what shows at t: WebKit queues media elements beyond a few.
    if (t < o.start || t > o.start + o.duration) continue;
    const url = assetUrl(edit, o.asset);
    if (!url) continue;
    const el =
      o.kind === "image"
        ? await loadImage(url).catch(() => null)
        : await load(url).catch(() => null);
    if (el) media.set(o.id, el);
  }
  try {
    const source = { width: video.videoWidth, height: video.videoHeight };
    const output = outputSize(edit.aspect, source, longSide);
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    const st = sourceTimeAt(edit.clips, t);
    if (st !== null) {
      await seek(video, st);
      if (camera) {
        const local = st - s.mediaOffset;
        if (local >= 0 && local <= camera.duration) await seek(camera, local);
      }
    }
    for (const o of edit.overlays) {
      const el = media.get(o.id);
      if (o.kind !== "video" || !(el instanceof HTMLVideoElement)) continue;
      const local = t - o.start + o.in;
      if (t >= o.start && t <= o.start + o.duration && local <= el.duration)
        await seek(el, local);
    }
    const began = performance.now();
    drawAt(
      ctx,
      {
        video,
        camera,
        mediaOf: (o) => media.get(o.id) ?? null,
      },
      edit,
      { ...timeline, source },
      output,
      t,
      1,
    );
    const ms = Math.round(performance.now() - began);
    return {
      ms,
      width: output.width,
      height: output.height,
      jpeg: canvas.toDataURL("image/jpeg", 0.85),
    };
  } finally {
    release(video);
    release(camera);
    for (const el of media.values())
      if (el instanceof HTMLVideoElement) release(el);
  }
}

export type Variant = { aspect: "9:16" | "16:9" | "1:1" | "4:5"; file: string };

/**
 * The same film in several formats, one export each. Formats are applied
 * with the film's own rules (device size, caption place); the montage on
 * screen is never changed.
 */
export async function exportVariants(
  aspects: Variant["aspect"][],
  o: { resolution: Resolution; fps: number },
): Promise<Variant[]> {
  const base = useEdit.getState().edit;
  const parsed = filmSchema.safeParse(base.film?.settings ?? {});
  const film = parsed.success ? parsed.data : filmSchema.parse({});
  const locale = base.film?.locale ?? "en-US";
  const out: Variant[] = [];
  for (const aspect of aspects) {
    const edit = base.film
      ? applyFilm(base, { ...film, aspect }, locale)
      : { ...base, aspect };
    const file = await exportCurrent(
      { ...o, label: `Exporting ${aspect}` },
      edit,
    );
    out.push({ aspect, file });
  }
  return out;
}
