import type { DeviceDefinition, Insets } from "@goscreen/device-registry";
import type { Orientation, ScreenLayout, Size } from "./types";

export function resolveViewport(
  device: DeviceDefinition,
  orientation: Orientation,
  override: Size | null = null,
): Size {
  const { width, height } = override ?? device.viewport;
  return orientation === "portrait"
    ? { width, height }
    : { width: height, height: width };
}

// Rotating the device a quarter turn counter-clockwise moves the top inset
// (status bar, island) to the left edge, as iOS and Android do.
export function resolveSafeArea(
  device: DeviceDefinition,
  orientation: Orientation,
): Insets {
  const s = device.safeArea;
  if (orientation === "portrait") return s;
  return { top: 0, bottom: s.bottom > 0 ? 20 : 0, left: s.top, right: s.top };
}

export function resolveScreenLayout(
  device: DeviceDefinition,
  orientation: Orientation,
  override: Size | null = null,
): ScreenLayout {
  const screen = resolveViewport(device, orientation, override);
  const bezel = device.frame.bezel;
  return {
    screen,
    bezel,
    frame: { width: screen.width + bezel * 2, height: screen.height + bezel * 2 },
    safeArea: resolveSafeArea(device, orientation),
  };
}

export function fitScale(content: Size, box: Size, padding = 0): number {
  const w = Math.max(1, box.width - padding * 2);
  const h = Math.max(1, box.height - padding * 2);
  return Math.min(w / content.width, h / content.height);
}

export const MIN_VIEWPORT: Size = { width: 240, height: 320 };
export const MAX_VIEWPORT: Size = { width: 3840, height: 3840 };

export type ResizeEdge = "right" | "bottom" | "corner";

// Applies a drag delta (in canvas units, as displayed) to a portrait-stored
// viewport. In landscape the displayed width is the stored height.
export function resizeViewport(
  start: Size,
  orientation: Orientation,
  edge: ResizeEdge,
  dx: number,
  dy: number,
): Size {
  const shown =
    orientation === "portrait"
      ? { ...start }
      : { width: start.height, height: start.width };
  if (edge !== "bottom") shown.width += dx;
  if (edge !== "right") shown.height += dy;
  const stored =
    orientation === "portrait"
      ? shown
      : { width: shown.height, height: shown.width };
  const clamp = (v: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, v)));
  return {
    width: clamp(stored.width, MIN_VIEWPORT.width, MAX_VIEWPORT.width),
    height: clamp(stored.height, MIN_VIEWPORT.height, MAX_VIEWPORT.height),
  };
}
