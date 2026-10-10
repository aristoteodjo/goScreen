import type { Asset, EditState } from "@goscreen/render-engine";

// Imported media, loaded once per URL and shared by preview and export.
// Elements are created off-DOM; videos stay muted here (their sound is
// played by the preview pool below and mixed by FFmpeg at export).

const images = new Map<string, HTMLImageElement>();

/** A decoded image, or null while it loads (`onReady` fires once it can be drawn). */
export function imageFor(
  url: string,
  onReady: () => void,
): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = onReady;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("An image could not be loaded."));
    img.src = url;
  });
}

export function mediaElement(
  kind: "video" | "audio",
  url: string,
): HTMLVideoElement | HTMLAudioElement {
  const el = document.createElement(kind);
  el.crossOrigin = "anonymous";
  el.preload = "auto";
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  el.src = url;
  return el;
}

/** Media elements of the preview, one per timeline item (video overlay or audio clip). */
const pool = new Map<
  string,
  { url: string; el: HTMLVideoElement | HTMLAudioElement }
>();

export function pooled(
  id: string,
  kind: "video" | "audio",
  url: string,
  onReady: () => void,
) {
  const hit = pool.get(id);
  if (hit && hit.url === url) return hit.el;
  hit?.el.pause();
  const el = mediaElement(kind, url);
  el.addEventListener("loadeddata", onReady);
  el.addEventListener("seeked", onReady);
  pool.set(id, { url, el });
  return el;
}

/** Drops elements whose timeline item is gone. */
export function prunePool(alive: Set<string>) {
  for (const [id, { el }] of pool) {
    if (alive.has(id)) continue;
    el.pause();
    el.removeAttribute("src");
    el.load();
    pool.delete(id);
  }
}

export function pooledEntries() {
  return pool.entries();
}

export function assetOf(edit: EditState, id: string): Asset | undefined {
  return edit.assets.find((a) => a.id === id);
}

/** Duration in seconds of a local media URL. */
export function probeDuration(
  kind: "video" | "audio",
  url: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = mediaElement(kind, url);
    el.muted = true;
    el.addEventListener("loadedmetadata", () => resolve(el.duration), {
      once: true,
    });
    el.addEventListener(
      "error",
      () => reject(new Error("The media could not be read.")),
      { once: true },
    );
  });
}
