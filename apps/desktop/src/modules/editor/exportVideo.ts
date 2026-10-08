import { composeFrame, type EditState, outputSize, tapTimes, type Timeline } from "@goscreen/render-engine";
import { ipc } from "@/lib/ipc";
import { drawFrame } from "./render";
import { trimEnd } from "./store";

export type ExportOptions = {
  edit: EditState;
  timeline: Timeline;
  videoPath: string;
  videoUrl: string;
  cameraUrl: string | null;
  mediaOffset: number;
  hasMic: boolean;
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Frame encoding failed."))), "image/jpeg", 0.92),
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

/**
 * Renders every output frame with the preview renderer and streams it to
 * FFmpeg. Deterministic: each frame is a seek, not a realtime capture.
 */
export async function exportVideo(o: ExportOptions): Promise<string> {
  const video = await load(o.videoUrl);
  const showCamera = o.cameraUrl !== null && o.edit.camera.visible;
  const camera = showCamera && o.cameraUrl ? await load(o.cameraUrl).catch(() => null) : null;

  const source = { width: video.videoWidth, height: video.videoHeight };
  const output = outputSize(o.edit.aspect, source, o.longSide);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");

  const start = o.edit.trim.start;
  const end = trimEnd(o.edit, video.duration);
  const frames = Math.max(1, Math.round((end - start) * o.fps));
  const timeline = { ...o.timeline, source };

  await ipc.exportBegin(o.name, o.fps);
  try {
    for (let i = 0; i < frames; i += 1) {
      if (o.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = Math.min(end, start + i / o.fps);
      await seek(video, t);
      if (camera) {
        const local = t - o.mediaOffset;
        if (local >= 0 && local <= camera.duration) await seek(camera, local);
      }
      drawFrame(ctx, { video, camera }, composeFrame(o.edit, timeline, output, t), o.edit, 1, timeline);
      await ipc.exportFrame(await (await jpeg(canvas)).arrayBuffer());
      o.onProgress((i + 1) / frames);
    }
    const clicks = o.edit.sound.clicks ? tapTimes(timeline.pointers, start, end) : [];
    const mic = o.hasMic
      ? { videoPath: o.videoPath, trimStartMs: start * 1000, volume: o.edit.mic.volume }
      : null;
    return await ipc.exportFinish(clicks, o.edit.sound.volume, mic);
  } catch (e) {
    await ipc.exportCancel().catch(() => {});
    throw e;
  } finally {
    release(video);
    release(camera);
  }
}
