import type { DeviceDefinition } from "@goscreen/device-registry";
import { resolveScreenLayout } from "./geometry";
import type { DeviceInstance, Size } from "./types";

export type LayoutItem = Pick<
  DeviceInstance,
  "id" | "orientation" | "scale" | "viewport"
> & { device: DeviceDefinition };

export type Placement = { x: number; y: number; scale: number };

// Decides where devices land on the stage when the user clicks "Auto layout",
// adds or removes a device, or changes the ratio. Every grid (1 row, 2 rows…)
// is tried; the one that lets the devices be biggest wins. Each item's `scale`
// is its size when alone; all shrink by the same factor so a tablet stays
// bigger than a phone. Returns the frame center and the new scale per id.
export function arrangeDevices(
  items: LayoutItem[],
  stage: Size,
  gap = 80,
  margin = 0.06,
): Map<string, Placement> {
  const out = new Map<string, Placement>();
  if (items.length === 0) return out;

  const sizes = items.map((it) => {
    const f = resolveScreenLayout(it.device, it.orientation, it.viewport).frame;
    return { width: f.width * it.scale, height: f.height * it.scale };
  });
  const room = { width: stage.width * (1 - margin * 2), height: stage.height * (1 - margin * 2) };

  let best: { rows: number[][]; factor: number } | null = null;
  for (let rowCount = 1; rowCount <= items.length; rowCount += 1) {
    const perRow = Math.ceil(items.length / rowCount);
    const rows: number[][] = [];
    for (let i = 0; i < items.length; i += perRow) rows.push(sizes.slice(i, i + perRow).map((_, j) => i + j));
    const rowWidth = (r: number[]) => r.reduce((s, i) => s + sizes[i].width, 0) + gap * (r.length - 1);
    const rowHeight = (r: number[]) => Math.max(...r.map((i) => sizes[i].height));
    const width = Math.max(...rows.map(rowWidth));
    const height = rows.reduce((s, r) => s + rowHeight(r), 0) + gap * (rows.length - 1);
    // Never grow past the single-device size; gaps shrink with the devices.
    const factor = Math.min(1, room.width / width, room.height / height);
    if (!best || factor > best.factor + 1e-9) best = { rows, factor };
  }
  if (!best) return out;

  const k = best.factor;
  const g = gap * k;
  const heights = best.rows.map((r) => Math.max(...r.map((i) => sizes[i].height * k)));
  const total = heights.reduce((s, h) => s + h, 0) + g * (best.rows.length - 1);
  let y = (stage.height - total) / 2;
  best.rows.forEach((r, ri) => {
    const width = r.reduce((s, i) => s + sizes[i].width * k, 0) + g * (r.length - 1);
    let x = (stage.width - width) / 2;
    for (const i of r) {
      const w = sizes[i].width * k;
      // Bottoms line up within a row, like devices standing on a desk.
      const cy = y + heights[ri] - (sizes[i].height * k) / 2;
      out.set(items[i].id, { x: x + w / 2, y: cy, scale: items[i].scale * k });
      x += w + g;
    }
    y += heights[ri] + g;
  });
  return out;
}
