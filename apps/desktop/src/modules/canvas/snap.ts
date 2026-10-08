import type { Size } from "@goscreen/device-engine";

/**
 * Called on every pointer move while a frame is drag-resized, after the raw
 * size has been clamped. Returns the size actually applied.
 *
 * `free` is true while Shift is held, so the user can opt out of snapping.
 */
export function snapViewportSize(size: Size, _free: boolean): Size {
  // TODO(you): decide how resizing snaps. See the request in the chat.
  return size;
}
