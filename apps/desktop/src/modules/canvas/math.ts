// Transform model: translate(panX, panY) scale(zoom). A canvas point (cx, cy)
// appears on screen at (cx * zoom + panX, cy * zoom + panY).

export type View = { zoom: number; panX: number; panY: number };
export type Rect = { x: number; y: number; width: number; height: number };

// Low floor: a 2240px iMac next to phones must fit on a laptop screen.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function screenToCanvas(sx: number, sy: number, v: View) {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

// Keeps the screen point (originX, originY) fixed while zooming.
export function zoomAt(v: View, nextZoom: number, originX: number, originY: number): View {
  const zoom = clampZoom(nextZoom);
  const k = zoom / v.zoom;
  return {
    zoom,
    panX: originX - k * (originX - v.panX),
    panY: originY - k * (originY - v.panY),
  };
}

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + 1e-9) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-9) ?? MIN_ZOOM;
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function fitView(bounds: Rect, viewport: { width: number; height: number }, padding = 80): View {
  const zoom = clampZoom(
    Math.min(
      1,
      (viewport.width - padding * 2) / Math.max(1, bounds.width),
      (viewport.height - padding * 2) / Math.max(1, bounds.height),
    ),
  );
  return {
    zoom,
    panX: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}
