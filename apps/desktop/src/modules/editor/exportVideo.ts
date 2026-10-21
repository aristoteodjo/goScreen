import {
  audioPieces,
  chunkPlan,
  type EditState,
  frameMotion,
  montageEnd,
  outputSize,
  type Placed,
  placeClips,
  type RecordingClip,
  sourceTimeAt,
  type Timeline,
  tapTimes,
} from "@goscreen/render-engine";
import { ipc, type Loudness } from "@/lib/ipc";
import { loadImage } from "./media";
import { drawAt, drawStill, stillTime, type TimelineSources } from "./render";

export type ExportOptions = {
  edit: EditState;
  timeline: Timeline;
  videoPath: string;
  // null: a montage without a recording; `timeline.source` gives the frame.
  videoUrl: string | null;
  cameraUrl: string | null;
  mediaOffset: number;
  hasMic: boolean;
  assetUrl: (assetId: string) => string | null;
  name: string;
  longSide: number;
  fps: number;
  signal: AbortSignal;
  onProgress: (done: number) => void;
  // Timeline stretches where a voice speaks: music ducks under them.
  voice?: [number, number][];
  // Bring the master to -14 LUFS / -1 dBTP (default yes).
  normalize?: boolean;
};

export type ExportResult = {
  file: string;
  // How the export was put together: chunks taken from the render cache
  // and chunks rendered now.
  chunks: { total: number; reused: number; rendered: number };
  // The master as measured after the mix; null for a silent film.
  loudness: Loudness | null;
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

export async function seek(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return;
  const done = once(video, "seeked");
  video.currentTime = t;
  await done;
}

function jpeg(canvas: HTMLCanvasElement, quality = 0.98): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Frame encoding failed."))),
      "image/jpeg",
      quality,
    ),
  );
}

/** A media that has not decoded its first frame by then is treated as missing. */
const LOAD_TIMEOUT_MS = 10_000;

export async function load(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const loaded = once(video, "loadeddata");
  video.src = url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The media did not load: ${url}`)),
      LOAD_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([loaded, late]);
  } catch (e) {
    release(video);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return video;
}

export function release(video: HTMLVideoElement | null) {
  if (!video) return;
  video.removeAttribute("src");
  video.load();
}

type OverlayMedia = Map<string, HTMLImageElement | HTMLVideoElement>;

/** Loads every image and video overlay once, up front. */
async function loadOverlayMedia(
  edit: EditState,
  urlOf: (assetId: string) => string | null,
): Promise<OverlayMedia> {
  const out: OverlayMedia = new Map();
  for (const o of edit.overlays) {
    if (o.kind !== "image" && o.kind !== "video") continue;
    const url = urlOf(o.asset);
    if (!url) continue;
    const media =
      o.kind === "image"
        ? await loadImage(url).catch(() => null)
        : await load(url).catch(() => null);
    if (media) out.set(o.id, media);
  }
  return out;
}

type FrameSource = Pick<
  ExportOptions,
  | "edit"
  | "timeline"
  | "videoUrl"
  | "cameraUrl"
  | "mediaOffset"
  | "assetUrl"
  | "longSide"
  | "fps"
>;

/**
 * Everything needed to draw any output frame of a montage with the preview
 * renderer: decoded media, the output canvas, the outgoing stills of
 * transitions. Deterministic: each frame is a seek, not a realtime capture.
 * Frames walk the timeline (clips back to back), not the source.
 */
export async function openFrames(o: FrameSource) {
  // No recording: nothing to decode, the frame is the montage's own size.
  const video = o.videoUrl === null ? null : await load(o.videoUrl);
  const showCamera = o.cameraUrl !== null && o.edit.camera.visible;
  const camera =
    showCamera && o.cameraUrl
      ? await load(o.cameraUrl).catch(() => null)
      : null;
  const overlayMedia = await loadOverlayMedia(o.edit, o.assetUrl);

  const source = video
    ? { width: video.videoWidth, height: video.videoHeight }
    : o.timeline.source;
  const output = outputSize(o.edit.aspect, source, o.longSide);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  // A function declaration below does not keep the null check: pin the type.
  const ctx: CanvasRenderingContext2D = context;

  const end = montageEnd(o.edit);
  const frames = Math.max(1, Math.round(end * o.fps));
  const timeline = { ...o.timeline, source };
  // Motion blur: frames where the picture moves are the average of several
  // instants over the frame (the video stays on its own frame); the faster
  // the move, the more instants, so copies smear instead of doubling.
  const acc = document.createElement("canvas");
  acc.width = output.width;
  acc.height = output.height;
  const actx = acc.getContext("2d");
  // Outgoing frames of transitions, rendered once before the frame loop.
  const stills = new Map<string, HTMLCanvasElement>();
  const placed = placeClips(o.edit.clips);
  for (let i = 1; i < placed.length; i += 1) {
    const prev = placed[i - 1];
    if (!video || !placed[i].clip.transition || prev.clip.kind !== "recording")
      continue;
    const p = prev as Placed<RecordingClip>;
    await seek(video, stillTime(p));
    if (camera) {
      const local = stillTime(p) - o.mediaOffset;
      if (local >= 0 && local <= camera.duration) await seek(camera, local);
    }
    const still = document.createElement("canvas");
    still.width = output.width;
    still.height = output.height;
    drawStill(still, { video, camera }, o.edit, timeline, output, p, 1);
    stills.set(p.clip.id, still);
  }

  const sources: TimelineSources = {
    video,
    camera,
    mediaOf: (ov) => overlayMedia.get(ov.id) ?? null,
    stillOf: (p) => stills.get(p.clip.id) ?? null,
  };

  /** Draws output frame i (timeline time i / fps) into the canvas. */
  async function draw(i: number) {
    const t = Math.min(end, i / o.fps);
    const s = sourceTimeAt(o.edit.clips, t);
    if (s !== null && video) {
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
      if (t >= ov.start && t <= ov.start + ov.duration && local <= el.duration)
        await seek(el, local);
    }
    const dt = 1 / o.fps;
    const motion = frameMotion(o.edit, timeline, output, t, dt);
    // About one sample per 3 px of travel, a 180° shutter (half the frame).
    const SAMPLES =
      motion > 0 ? Math.max(2, Math.min(8, Math.ceil(motion / 3))) : 1;
    if (actx && SAMPLES > 1) {
      actx.globalAlpha = 1;
      actx.clearRect(0, 0, output.width, output.height);
      for (let k = 0; k < SAMPLES; k += 1) {
        const tk = Math.max(
          0,
          Math.min(
            end,
            t + ((k - (SAMPLES - 1) / 2) * dt) / (2 * (SAMPLES - 1)),
          ),
        );
        drawAt(ctx, sources, o.edit, timeline, output, tk, 1);
        actx.globalAlpha = 1 / (k + 1);
        actx.drawImage(canvas, 0, 0);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(acc, 0, 0);
      ctx.restore();
    } else {
      drawAt(ctx, sources, o.edit, timeline, output, t, 1);
    }
  }

  return {
    source,
    output,
    timeline,
    end,
    frames,
    canvas,
    draw,
    jpeg: async (quality?: number) =>
      (await jpeg(canvas, quality)).arrayBuffer(),
    close() {
      release(video);
      release(camera);
      for (const el of overlayMedia.values())
        if (el instanceof HTMLVideoElement) release(el);
    },
  };
}

const aborted = () => new DOMException("Export cancelled", "AbortError");

/**
 * Exports the montage to MP4. The timeline is cut into chunks; the ones
 * already in the render cache with the same fingerprint are reused, the
 * others are rendered and streamed to FFmpeg; then the chunks are joined
 * and the soundtrack mixed in one pass.
 */
export async function exportVideo(o: ExportOptions): Promise<ExportResult> {
  const f = await openFrames(o);
  try {
    const plan = chunkPlan(o.edit, {
      fps: o.fps,
      longSide: o.longSide,
      source: f.source,
    });
    const have = new Set(await ipc.renderCacheList(o.videoPath));
    const total = plan.reduce((s, c) => s + c.frames, 0);
    let done = 0;
    let reused = 0;
    let rendered = 0;
    for (const chunk of plan) {
      if (o.signal.aborted) throw aborted();
      if (have.has(chunk.hash)) {
        reused += 1;
        done += chunk.frames;
        o.onProgress(done / total);
        continue;
      }
      await ipc.chunkBegin(o.videoPath, chunk.hash, o.fps);
      try {
        for (let i = 0; i < chunk.frames; i += 1) {
          if (o.signal.aborted) throw aborted();
          await f.draw(chunk.frame + i);
          await ipc.exportFrame(await f.jpeg());
          done += 1;
          o.onProgress(done / total);
        }
        await ipc.chunkFinish();
      } catch (e) {
        await ipc.exportCancel().catch(() => {});
        throw e;
      }
      rendered += 1;
      have.add(chunk.hash);
    }
    const clicks = o.edit.sound.clicks
      ? tapTimes(f.timeline.pointers, o.edit.clips)
      : [];
    const { file, loudness } = await ipc.exportAssemble(
      o.videoPath,
      o.name,
      plan.map((c) => c.hash),
      clicks,
      o.edit.sound.volume,
      audioPieces(o.edit, o.hasMic, o.voice ?? []),
      o.normalize ?? true,
    );
    return {
      file,
      chunks: { total: plan.length, reused, rendered },
      loudness,
    };
  } finally {
    f.close();
  }
}

export type PreviewOptions = Omit<ExportOptions, "name" | "hasMic"> & {
  from: number;
  to: number;
};

/**
 * A small, fast and silent draft of `from..to`: the same frames as the
 * export at a lower size and frame rate, written to `<stem>.previews/`.
 */
export async function exportPreview(o: PreviewOptions): Promise<string> {
  const f = await openFrames(o);
  try {
    const from = Math.max(0, Math.min(f.end, o.from));
    const to = Math.max(from, Math.min(f.end, o.to));
    const first = Math.round(from * o.fps);
    const last = Math.max(first + 1, Math.round(to * o.fps));
    await ipc.previewBegin(o.videoPath, from, to, o.fps, o.longSide);
    try {
      for (let i = first; i < last; i += 1) {
        if (o.signal.aborted) throw aborted();
        await f.draw(i);
        await ipc.exportFrame(await f.jpeg(0.9));
        o.onProgress((i + 1 - first) / (last - first));
      }
      return await ipc.previewFinish();
    } catch (e) {
      await ipc.exportCancel().catch(() => {});
      throw e;
    }
  } finally {
    f.close();
  }
}
