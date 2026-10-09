import type { CameraEdit, FrameGeometry, LayerEdit, LayerRect, PlacedLayer, Point, Rect, Size } from "./types";

/** The layer rect in effect at time t (rects are logged when they change). */
export function rectAt(rects: LayerRect[], t: number): LayerRect | null {
  let current: LayerRect | null = rects[0] ?? null;
  for (const r of rects) {
    if (r.t <= t) current = r;
    else break;
  }
  return current;
}

const SPLIT = 0.34;

/** Where devices live: the whole output, or what the split camera leaves. */
export function stageArea(output: Size, camera: CameraEdit, hasCamera: boolean): Rect {
  if (!hasCamera || !camera.visible || camera.layout !== "split") {
    return { x: 0, y: 0, width: output.width, height: output.height };
  }
  return output.width >= output.height
    ? { x: 0, y: 0, width: output.width * (1 - SPLIT), height: output.height }
    : { x: 0, y: 0, width: output.width, height: output.height * (1 - SPLIT) };
}

/** Webcam rectangle in output px, or null when there is none to show. */
export function webcamRect(output: Size, camera: CameraEdit, hasCamera: boolean): Rect | null {
  if (!hasCamera || !camera.visible) return null;
  const short = Math.min(output.width, output.height);
  const margin = short * 0.04;
  if (camera.layout === "split") {
    const landscape = output.width >= output.height;
    const col = landscape
      ? { x: output.width * (1 - SPLIT), y: 0, width: output.width * SPLIT, height: output.height }
      : { x: 0, y: output.height * (1 - SPLIT), width: output.width, height: output.height * SPLIT };
    const side = Math.min(col.width, col.height) - margin * 2;
    return { x: col.x + (col.width - side) / 2, y: col.y + (col.height - side) / 2, width: side, height: side };
  }
  const side = short * Math.max(0.08, Math.min(0.6, camera.size));
  const col = camera.corner % 3;
  const row = Math.floor(camera.corner / 3);
  const at = (i: number, total: number) => (i === 0 ? margin : i === 1 ? (total - side) / 2 : total - side - margin);
  return { x: at(col, output.width), y: at(row, output.height), width: side, height: side };
}

/** The 3x3 overlay slot (0 = top-left) whose center is closest to `point`. */
export function nearestCorner(output: Size, camera: CameraEdit, point: Point): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let corner = 0; corner < 9; corner += 1) {
    const r = webcamRect(output, { ...camera, layout: "overlay", visible: true, corner }, true);
    if (!r) continue;
    const d = Math.hypot(r.x + r.width / 2 - point.x, r.y + r.height / 2 - point.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = corner;
    }
  }
  return best;
}

/** Side-by-side starting layout, bottoms aligned, normalized to the area. */
export function arrangeLayers(frames: Size[], area: Size, gap = 0.05): { x: number; y: number; scale: number }[] {
  if (frames.length === 0) return [];
  const gapPx = area.width * gap;
  const tallest = Math.max(...frames.map((f) => f.height));
  const totalW = frames.reduce((s, f) => s + f.width, 0);
  const k = Math.min(
    (area.height * 0.8) / tallest,
    (area.width * 0.9 - gapPx * (frames.length - 1)) / Math.max(1, totalW),
  );
  const rowW = totalW * k + gapPx * (frames.length - 1);
  let left = (area.width - rowW) / 2;
  const bottom = (area.height + tallest * k) / 2;
  return frames.map((f) => {
    const w = f.width * k;
    const h = f.height * k;
    const out = { x: (left + w / 2) / area.width, y: (bottom - h / 2) / area.height, scale: h / area.height };
    left += w + gapPx;
    return out;
  });
}

export function placeLayer(edit: LayerEdit, geometry: FrameGeometry, area: Rect, crop: Rect): PlacedLayer {
  return {
    instanceId: edit.instanceId,
    center: { x: area.x + edit.x * area.width, y: area.y + edit.y * area.height },
    scale: (edit.scale * area.height) / Math.max(1, geometry.frame.height),
    rotation: (edit.rotation * Math.PI) / 180,
    geometry,
    crop,
    frame: edit.frame,
  };
}

/** A point of the layer's screen (u, v in 0..1) in output px. */
export function layerPoint(layer: PlacedLayer, u: number, v: number): Point {
  const { frame, screen } = layer.geometry;
  const lx = (screen.x + u * screen.width - frame.width / 2) * layer.scale;
  const ly = (screen.y + v * screen.height - frame.height / 2) * layer.scale;
  const c = Math.cos(layer.rotation);
  const s = Math.sin(layer.rotation);
  return { x: layer.center.x + lx * c - ly * s, y: layer.center.y + lx * s + ly * c };
}

/** Topmost layer under an output point. */
export function hitLayer(layers: PlacedLayer[], p: Point): string | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const l = layers[i];
    const dx = p.x - l.center.x;
    const dy = p.y - l.center.y;
    const c = Math.cos(-l.rotation);
    const s = Math.sin(-l.rotation);
    const x = (dx * c - dy * s) / l.scale;
    const y = (dx * s + dy * c) / l.scale;
    if (Math.abs(x) <= l.geometry.frame.width / 2 && Math.abs(y) <= l.geometry.frame.height / 2) return l.instanceId;
  }
  return null;
}
