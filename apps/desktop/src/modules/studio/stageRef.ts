import type { CaptureRegion } from "@/lib/ipc";

let element: HTMLElement | null = null;

export function setStageElement(el: HTMLElement | null) {
  element = el;
}

// Window-relative CSS pixels, which Rust converts to physical screen pixels.
export function stageRegion(): CaptureRegion | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}
