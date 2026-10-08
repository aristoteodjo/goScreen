import type { Insets } from "@goscreen/device-registry";

export type Orientation = "portrait" | "landscape";

export type RenderMode = "flat" | "floating" | "perspective";

export type BrowserChrome = "none" | "minimal" | "safari" | "chrome-android";

export type StatusBarMode = "auto" | "hidden";

export type Size = { width: number; height: number };

export type Shadow = {
  color: string;
  opacity: number;
  blur: number;
  spread: number;
  offsetX: number;
  offsetY: number;
};

// One placed device on a stage. Position is the frame center in stage units.
export type DeviceInstance = {
  id: string;
  deviceId: string;
  colorId: string;
  orientation: Orientation;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  tilt: number;
  renderMode: RenderMode;
  shadow: Shadow;
  browserChrome: BrowserChrome;
  statusBar: StatusBarMode;
  // Custom viewport in portrait terms, set by drag-resizing a frame.
  viewport: Size | null;
};

export type ScreenLayout = {
  frame: Size;
  screen: Size;
  bezel: number;
  safeArea: Insets;
};
