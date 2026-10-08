import type { DeviceDefinition } from "@goscreen/device-registry";
import { resolveScreenLayout } from "./geometry";
import type { DeviceInstance, Size } from "./types";

export type LayoutItem = Pick<
  DeviceInstance,
  "id" | "orientation" | "scale" | "viewport"
> & { device: DeviceDefinition };

// Decides where devices land on the stage when the user clicks "Auto layout"
// or adds a device. Returns the frame center for each instance id.
export function arrangeDevices(
  items: LayoutItem[],
  stage: Size,
  gap = 80,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (items.length === 0) return positions;

  const widths = items.map(
    (it) => resolveScreenLayout(it.device, it.orientation, it.viewport).frame.width *
      it.scale,
  );
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let cursor = (stage.width - total) / 2;
  items.forEach((it, i) => {
    positions.set(it.id, { x: cursor + widths[i] / 2, y: stage.height / 2 });
    cursor += widths[i] + gap;
  });
  return positions;
}
