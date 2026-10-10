import {
  clipAt,
  composeFrame,
  type EditState,
  type Frame,
  type Placed,
  type RecordingClip,
  type Rect,
  type Size,
  sourceTimeAt,
  type Timeline,
  type TransitionMix,
  transitionAt,
  transitionMix,
} from "@goscreen/render-engine";
import { drawDevice } from "./devices";
import {
  drawOverlays,
  drawSlide,
  fillBackground,
  type MediaOf,
} from "./drawOverlays";

export type Sources = {
  video: CanvasImageSource | null;
  camera: HTMLVideoElement | null;
};

export type TimelineSources = Sources & {
  mediaOf: MediaOf;
  // Last frame of a recording clip, for the outgoing side of a transition.
  stillOf?: (p: Placed<RecordingClip>) => CanvasImageSource | null;
};

/**
 * Draws timeline time t: the clip playing (recording or slide), mixed with
 * the end of the previous clip during a transition, then the overlays.
 * Preview and export both go through here.
 */
export function drawAt(
  ctx: CanvasRenderingContext2D,
  sources: TimelineSources,
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  pixelScale: number,
) {
  const tr = transitionAt(edit.clips, t);
  if (!tr) {
    drawClip(ctx, sources, edit, timeline, output, t, pixelScale);
  } else {
    const { width, height } = ctx.canvas;
    const to = scratch(0, width, height);
    drawClip(
      to.getContext("2d") as CanvasRenderingContext2D,
      sources,
      edit,
      timeline,
      output,
      t,
      pixelScale,
    );
    let from: CanvasImageSource | null = null;
    if (tr.prev.clip.kind === "slide") {
      const c = scratch(1, width, height);
      const fctx = c.getContext("2d") as CanvasRenderingContext2D;
      drawClip(
        fctx,
        sources,
        edit,
        timeline,
        output,
        tr.prev.end - 1e-3,
        pixelScale,
      );
      from = c;
    } else {
      from = sources.stillOf?.(tr.prev as Placed<RecordingClip>) ?? null;
    }
    mixTransition(ctx, transitionMix(tr.kind, tr.progress), from, to);
  }

  const hidden = edit.tracks.hidden;
  const overlays = hidden.length
    ? edit.overlays.filter((o) => !hidden.includes(o.lane))
    : edit.overlays;
  if (overlays.length === 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.scale(pixelScale, pixelScale);
  drawOverlays(ctx, overlays, t, output, sources.mediaOf);
  ctx.restore();
}

/** One clip of the main track at timeline time t, without overlays. */
function drawClip(
  ctx: CanvasRenderingContext2D,
  sources: Sources,
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  pixelScale: number,
) {
  const p = clipAt(edit.clips, t);
  if (p?.clip.kind === "slide") {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.scale(pixelScale, pixelScale);
    drawSlide(ctx, p.clip, t - p.start, output);
    ctx.restore();
    return;
  }
  const hidden = p?.clip.kind === "recording" && p.clip.cameraHidden;
  const e = hidden
    ? { ...edit, camera: { ...edit.camera, visible: false } }
    : edit;
  const s = sourceTimeAt(edit.clips, t) ?? 0;
  drawFrame(
    ctx,
    sources,
    composeFrame(e, timeline, output, s),
    e,
    pixelScale,
    timeline,
  );
}

/** Source time of the frame a recording clip ends on. */
export function stillTime(p: Placed<RecordingClip>): number {
  return Math.max(p.clip.in, p.clip.out - 1 / 60);
}

/**
 * Paints the last frame of a recording clip into `canvas`. The caller has
 * already put `sources.video` (and camera) on `stillTime(p)`.
 */
export function drawStill(
  canvas: HTMLCanvasElement,
  sources: Sources,
  edit: EditState,
  timeline: Timeline,
  output: Size,
  p: Placed<RecordingClip>,
  pixelScale: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const e = p.clip.cameraHidden
    ? { ...edit, camera: { ...edit.camera, visible: false } }
    : edit;
  drawFrame(
    ctx,
    sources,
    composeFrame(e, timeline, output, stillTime(p)),
    e,
    pixelScale,
    timeline,
  );
}

const scratches: HTMLCanvasElement[] = [];

/** Reused offscreen canvases, so a transition does not allocate per frame. */
function scratch(i: number, width: number, height: number): HTMLCanvasElement {
  let c = scratches[i];
  if (!c) {
    c = document.createElement("canvas");
    scratches[i] = c;
  }
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  return c;
}

function mixTransition(
  ctx: CanvasRenderingContext2D,
  mix: TransitionMix,
  from: CanvasImageSource | null,
  to: CanvasImageSource,
) {
  const { width: w, height: h } = ctx.canvas;
  const layer = (
    img: CanvasImageSource | null,
    side: TransitionMix["from"],
    reveal = 1,
  ) => {
    if (!img || side.alpha <= 0) return;
    ctx.save();
    if (reveal < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, w * reveal, h);
      ctx.clip();
    }
    ctx.globalAlpha = side.alpha;
    ctx.translate(w / 2 + side.dx * w, h / 2 + side.dy * h);
    ctx.scale(side.scale, side.scale);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (mix.fromOnTop) {
    layer(to, mix.to);
    layer(from, mix.from);
  } else {
    layer(from, mix.from);
    layer(to, mix.to, mix.reveal);
  }
  if (mix.dip > 0) {
    ctx.globalAlpha = Math.min(1, mix.dip);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

const REFERENCE = 1080;

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(
    r.x,
    r.y,
    r.width,
    r.height,
    Math.min(radius, r.width / 2, r.height / 2),
  );
}

function hexAlpha(hex: string, alpha: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Draws one composed frame. `pixelScale` maps output pixels to canvas
 * pixels (preview quality, HiDPI); export uses 1.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sources: Sources,
  frame: Frame,
  edit: EditState,
  pixelScale: number,
  timeline: Timeline,
) {
  const { video } = sources;
  const { output, content, camera } = frame;
  const k = Math.min(output.width, output.height) / REFERENCE;
  const framed = edit.background.kind !== "none";
  // Canvas shadows ignore the transform, so they are scaled by hand.
  const shadowScale = pixelScale * camera.scale;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The default "low" smoothing turns every scaled screen soft.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(pixelScale, pixelScale);
  // The camera moves over the whole composition, background included.
  ctx.translate(output.width / 2, output.height / 2);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.center.x, -camera.center.y);

  fillBackground(ctx, edit.background, output.width, output.height);

  const radius = framed ? edit.radius * k : 0;
  const layered = frame.layers.length > 0;
  for (const layer of frame.layers) {
    const le = edit.layers?.find((l) => l.instanceId === layer.instanceId);
    const recorded = timeline.layers.find(
      (l) => l.instanceId === layer.instanceId,
    );
    if (!le || !recorded) continue;
    ctx.save();
    ctx.translate(layer.center.x, layer.center.y);
    ctx.rotate(layer.rotation);
    ctx.scale(layer.scale, layer.scale);
    ctx.translate(
      -layer.geometry.frame.width / 2,
      -layer.geometry.frame.height / 2,
    );
    drawDevice(
      ctx,
      layer,
      le,
      recorded,
      video ? { image: video, crop: layer.crop } : null,
      edit.shadow,
      shadowScale * layer.scale,
    );
    ctx.restore();
  }
  if (!layered && framed && edit.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.55 * edit.shadow})`;
    ctx.shadowBlur = 70 * edit.shadow * k * shadowScale;
    ctx.shadowOffsetY = 22 * edit.shadow * k * shadowScale;
    ctx.fillStyle = "#000";
    roundRect(ctx, content, radius);
    ctx.fill();
    ctx.restore();
  }

  if (!layered) {
    ctx.save();
    roundRect(ctx, content, radius);
    ctx.clip();
    if (video) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, content.x, content.y, content.width, content.height);
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(content.x, content.y, content.width, content.height);
    }
    ctx.restore();
  }

  const base = (edit.touch.size / 2) * k;
  for (const m of frame.touches) {
    const r = base * m.scale;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    if (edit.touch.style === "solid") {
      ctx.fillStyle = hexAlpha(edit.touch.color, 0.45 * m.opacity);
      ctx.fill();
    } else {
      ctx.fillStyle = hexAlpha(edit.touch.color, 0.18 * m.opacity);
      ctx.fill();
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = hexAlpha(edit.touch.color, 0.9 * m.opacity);
      ctx.stroke();
    }
  }
  ctx.restore();

  // The webcam stays put while the camera zooms into the screens.
  if (frame.webcam) {
    ctx.save();
    ctx.scale(pixelScale, pixelScale);
    drawWebcam(ctx, sources.camera, frame.webcam, edit, k, pixelScale);
    ctx.restore();
  }
}

function drawWebcam(
  ctx: CanvasRenderingContext2D,
  camera: HTMLVideoElement | null,
  r: Rect,
  edit: EditState,
  k: number,
  pixelScale: number,
) {
  const shape = edit.camera.shape;
  const radius =
    shape === "circle"
      ? r.width / 2
      : shape === "rounded"
        ? r.width * 0.18
        : 6 * k;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 40 * k * pixelScale;
  ctx.shadowOffsetY = 14 * k * pixelScale;
  ctx.fillStyle = "#111";
  roundRect(ctx, r, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, r, radius);
  ctx.clip();
  if (camera && camera.readyState >= 2 && camera.videoWidth > 0) {
    // Cover: center-crop the camera to the overlay's square.
    const side = Math.min(camera.videoWidth, camera.videoHeight);
    const sx = (camera.videoWidth - side) / 2;
    const sy = (camera.videoHeight - side) / 2;
    if (edit.camera.mirror) {
      ctx.translate(r.x + r.width, r.y);
      ctx.scale(-1, 1);
      ctx.drawImage(camera, sx, sy, side, side, 0, 0, r.width, r.height);
    } else {
      ctx.drawImage(camera, sx, sy, side, side, r.x, r.y, r.width, r.height);
    }
  }
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 2 * k;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  roundRect(ctx, r, radius);
  ctx.stroke();
  ctx.restore();
}
