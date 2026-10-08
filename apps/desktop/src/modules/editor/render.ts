import type { EditBackground, EditState, Frame, Rect, Timeline } from "@goscreen/render-engine";
import { drawDevice } from "./devices";

export type Sources = {
  video: CanvasImageSource | null;
  camera: HTMLVideoElement | null;
};

const REFERENCE = 1080;

function fillBackground(ctx: CanvasRenderingContext2D, bg: EditBackground, w: number, h: number) {
  if (bg.kind === "none") {
    ctx.fillStyle = "#000";
  } else if (bg.kind === "color") {
    ctx.fillStyle = bg.value;
  } else {
    // CSS angles: 0deg points up, clockwise.
    const a = ((bg.angle - 90) * Math.PI) / 180;
    const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createLinearGradient(
      cx - Math.cos(a) * half,
      cy - Math.sin(a) * half,
      cx + Math.cos(a) * half,
      cy + Math.sin(a) * half,
    );
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, Math.min(radius, r.width / 2, r.height / 2));
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
    const recorded = timeline.layers.find((l) => l.instanceId === layer.instanceId);
    if (!le || !recorded) continue;
    ctx.save();
    ctx.translate(layer.center.x, layer.center.y);
    ctx.rotate(layer.rotation);
    ctx.scale(layer.scale, layer.scale);
    ctx.translate(-layer.geometry.frame.width / 2, -layer.geometry.frame.height / 2);
    drawDevice(ctx, layer, le, recorded, video ? { image: video, crop: layer.crop } : null, edit.shadow, shadowScale * layer.scale);
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
  const radius = shape === "circle" ? r.width / 2 : shape === "rounded" ? r.width * 0.18 : 6 * k;
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
