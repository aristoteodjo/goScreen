import {
  audioPieces,
  type EditState,
  outputSize,
  sequenceDuration,
  sourceTimeAt,
  tapTimes,
  type Timeline,
} from "@goscreen/render-engine";
import { ipc } from "@/lib/ipc";
import { loadImage } from "./media";
import { drawAt, type TimelineSources } from "./render";

export type ExportOptions = {
  edit: EditState;
  timeline: Timeline;
  videoPath: string;
  videoUrl: string;
  cameraUrl: string | null;
  mediaOffset: number;
  hasMic: boolean;
  assetUrl: (assetId: string) => string | null;
  name: string;
  longSide: number;
  fps: number;
  signal: AbortSignal;
  onProgress: (done: number) => void;
};

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener("error", ko);
      resolve();
    };
    const ko = () => {
      target.removeEventListener(event, ok);
      reject(new Error("The recording could not be decoded."));
    };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener("error", ko, { once: true });
  });
}

async function seek(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return;
  const done = once(video, "seeked");
  video.currentTime = t;
  await done;
}

function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Frame encoding failed."))), "image/jpeg", 0.98),
  );
}

async function load(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const loaded = once(video, "loadeddata");
  video.src = url;
  await loaded;
  return video;
}

function release(video: HTMLVideoElement | null) {
  if (!video) return;
  video.removeAttribute("src");
  video.load();
}

type OverlayMedia = Map<string, HTMLImageElement | HTMLVideoElement>;

/** Loads every image and video overlay once, up front. */
async function loadOverlayMedia(edit: EditState, urlOf: (assetId: string) => string | null): Promise<OverlayMedia> {
  const out: OverlayMedia = new Map();
  for (const o of edit.overlays) {
    if (o.kind !== "image" && o.kind !== "video") continue;
    const url = urlOf(o.asset);
    if (!url) continue;
    const media = o.kind === "image" ? await loadImage(url).catch(() => null) : await load(url).catch(() => null);
    if (media) out.set(o.id, media);
  }
  return out;
}

/**
 * Renders every output frame with the preview renderer and streams it to
 * FFmpeg. Deterministic: each frame is a seek, not a realtime capture.
 * Frames walk the timeline (clips back to back), not the source.
 */
export async function exportVideo(o: ExportOptions): Promise<string> {
  const video = await load(o.videoUrl);
  const showCamera = o.cameraUrl !== null && o.edit.camera.visible;
  const camera = showCamera && o.cameraUrl ? await load(o.cameraUrl).catch(() => null) : null;
  const overlayMedia = await loadOverlayMedia(o.edit, o.assetUrl);

  const source = { width: video.videoWidth, height: video.videoHeight };
  const output = outputSize(o.edit.aspect, source, o.longSide);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");

  const end = sequenceDuration(o.edit.clips);
  const frames = Math.max(1, Math.round(end * o.fps));
  const timeline = { ...o.timeline, source };
  const sources: TimelineSources = {
    video,
    camera,
    mediaOf: (ov) => overlayMedia.get(ov.id) ?? null,
  };

  await ipc.exportBegin(o.name, o.fps);
  try {
    for (let i = 0; i < frames; i += 1) {
      if (o.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = Math.min(end, i / o.fps);
      const s = sourceTimeAt(o.edit.clips, t);
      if (s !== null) {
        await seek(video, s);
        if (camera) {
          const local = s - o.mediaOffset;
          if (local >= 0 && local <= camera.duration) await seek(camera, local);
        }
      }
      for (const ov of o.edit.overlays) {
        const el = overlayMedia.get(ov.id);
        if (ov.kind !== "video" || !(el instanceof HTMLVideoElement)) continue;
        const local = t - ov.start + ov.in;
        if (t >= ov.start && t <= ov.start + ov.duration && local <= el.duration) await seek(el, local);
      }
      drawAt(ctx, sources, o.edit, timeline, output, t, 1);
      await ipc.exportFrame(await (await jpeg(canvas)).arrayBuffer());
      o.onProgress((i + 1) / frames);
    }
    const clicks = o.edit.sound.clicks ? tapTimes(timeline.pointers, o.edit.clips) : [];
    return await ipc.exportFinish(o.videoPath, clicks, o.edit.sound.volume, audioPieces(o.edit, o.hasMic));
  } catch (e) {
    await ipc.exportCancel().catch(() => {});
    throw e;
  } finally {
    release(video);
    release(camera);
    for (const el of overlayMedia.values()) if (el instanceof HTMLVideoElement) release(el);
  }
}
