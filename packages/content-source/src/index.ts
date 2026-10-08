/**
 * Content sources: what a device frame displays. The Device Engine only
 * knows frames; it never learns where the pixels come from. Web pages,
 * Android emulators and physical devices all plug in through this contract.
 */

export type Orientation = "portrait" | "landscape";

/** Native pixels plus density (dpi) when the source knows it. */
export type Resolution = { width: number; height: number; density: number | null };

/** How the UI shows a source's live pixels. */
export type FrameSource =
  | { kind: "iframe"; url: string }
  | { kind: "mjpeg"; url: string }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string };

/** Serializable pointer to a source, stored on a project device. */
export type ContentSourceRef = { kind: "web" } | { kind: "android"; serial: string };

export const WEB_SOURCE: ContentSourceRef = { kind: "web" };

export function sourceKey(ref: ContentSourceRef): string {
  return ref.kind === "web" ? "web" : `android:${ref.serial}`;
}

export function sameSource(a: ContentSourceRef, b: ContentSourceRef): boolean {
  return sourceKey(a) === sourceKey(b);
}

/**
 * A live source. `startCapture` exists for sources that can record natively;
 * sources without it are captured by the stage recorder like any web page.
 */
export interface DeviceContentSource {
  readonly ref: ContentSourceRef;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getResolution(): Promise<Resolution>;
  getOrientation(): Promise<Orientation>;
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  getFrameSource(): FrameSource;
}

/** CSS viewport, in portrait terms, that shows a source at its true aspect. */
export function viewportFor(resolution: Resolution): { width: number; height: number } {
  const dpr = resolution.density ? resolution.density / 160 : 1;
  const short = Math.min(resolution.width, resolution.height);
  const long = Math.max(resolution.width, resolution.height);
  return { width: Math.round(short / dpr), height: Math.round(long / dpr) };
}
