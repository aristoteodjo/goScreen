import { type Point, type Quad, quadMapper } from "@goscreen/render-engine";
import type { CaptureRegion } from "@/lib/ipc";

// The screen area of each device, holding four zero-size corner markers.
// Their on-screen boxes give the exact projected quad, whatever rotation,
// scale or perspective tilt the frame has.
const screens = new Map<string, HTMLElement>();
// The whole glass of each device (status bar included): what becomes a layer.
const glasses = new Map<string, HTMLElement>();

export function registerScreen(instanceId: string, el: HTMLElement | null) {
  if (el) screens.set(instanceId, el);
  else screens.delete(instanceId);
}

export function registerGlass(instanceId: string, el: HTMLElement | null) {
  if (el) glasses.set(instanceId, el);
  else glasses.delete(instanceId);
}

export function screenElements(): ReadonlyMap<string, HTMLElement> {
  return glasses;
}

const CORNERS = ["tl", "tr", "br", "bl"] as const;

function projectedQuad(el: HTMLElement): Quad | null {
  const points = CORNERS.map((c) => {
    const marker = el.querySelector<HTMLElement>(`[data-corner="${c}"]`);
    if (!marker) return null;
    const r = marker.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  return points.every(Boolean) ? (points as Quad) : null;
}

/** Window-space box of a device's glass (exact when the frame is flat). */
export function screenRect(instanceId: string): CaptureRegion | null {
  const el = glasses.get(instanceId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

function contentUV(instanceId: string, x: number, y: number): Point | null {
  const el = screens.get(instanceId);
  if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
  return { x: x / el.offsetWidth, y: y / el.offsetHeight };
}

/**
 * A point of the page (CSS px, as the iframe or Android view reports it)
 * -> 0..1 inside the whole glass, the space of a recorded layer.
 */
export function screenUV(instanceId: string, x: number, y: number): Point | null {
  const content = screens.get(instanceId);
  const glass = glasses.get(instanceId);
  if (!content || !glass || glass.offsetWidth === 0 || glass.offsetHeight === 0) return null;
  // The glass is the content's offsetParent: offsets are layout px, untransformed.
  return { x: (x + content.offsetLeft) / glass.offsetWidth, y: (y + content.offsetTop) / glass.offsetHeight };
}

/**
 * A point in a device screen -> normalized coordinates (0..1) of the
 * captured region, the space of the recorded video.
 */
export function toRegionPoint(instanceId: string, x: number, y: number, region: CaptureRegion): Point | null {
  const el = screens.get(instanceId);
  const uv = contentUV(instanceId, x, y);
  if (!el || !uv || region.width === 0 || region.height === 0) return null;
  const quad = projectedQuad(el);
  if (!quad) return null;
  const p = quadMapper(quad)(uv.x, uv.y);
  return { x: (p.x - region.x) / region.width, y: (p.y - region.y) / region.height };
}
