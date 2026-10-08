import type { DeviceDefinition, Insets } from "@goscreen/device-registry";
import type { Orientation, ScreenLayout, Size } from "./types";

export function resolveViewport(
  device: DeviceDefinition,
  orientation: Orientation,
): Size {
  const { width, height } = device.viewport;
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
): ScreenLayout {
  const screen = resolveViewport(device, orientation);
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
