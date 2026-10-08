import type { AspectId, Rect, Size } from "./types";

export const ASPECT_OPTIONS: { id: AspectId; label: string; ratio: string }[] = [
  { id: "auto", label: "Auto", ratio: "" },
  { id: "16:9", label: "Wide", ratio: "16:9" },
  { id: "1:1", label: "Square", ratio: "1:1" },
  { id: "4:3", label: "Classic", ratio: "4:3" },
  { id: "9:16", label: "Vertical", ratio: "9:16" },
  { id: "3:4", label: "Tall", ratio: "3:4" },
  { id: "4:5", label: "Portrait", ratio: "4:5" },
];

const RATIOS: Record<Exclude<AspectId, "auto">, number> = {
  "16:9": 16 / 9,
  "1:1": 1,
  "4:3": 4 / 3,
  "9:16": 9 / 16,
  "3:4": 3 / 4,
  "4:5": 4 / 5,
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output frame size. The long side is fixed; H.264 needs even dimensions. */
export function outputSize(aspect: AspectId, source: Size, longSide = 1920): Size {
  const ratio = aspect === "auto" ? source.width / Math.max(1, source.height) : RATIOS[aspect];
  return ratio >= 1
    ? { width: even(longSide), height: even(longSide / ratio) }
    : { width: even(longSide * ratio), height: even(longSide) };
}

/** Where the source video sits inside the output, letterboxed by padding. */
export function contentRect(output: Size, source: Size, padding: number): Rect {
  const inset = Math.min(output.width, output.height) * Math.max(0, Math.min(0.4, padding));
  const room = { width: output.width - inset * 2, height: output.height - inset * 2 };
  const scale = Math.min(room.width / Math.max(1, source.width), room.height / Math.max(1, source.height));
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (output.width - width) / 2, y: (output.height - height) / 2, width, height };
}

/** Largest rectangle of the given size ratio that fits a box, centered. */
export function fitInto(box: Size, size: Size): Rect {
  const scale = Math.min(box.width / Math.max(1, size.width), box.height / Math.max(1, size.height));
  const width = size.width * scale;
  const height = size.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}
