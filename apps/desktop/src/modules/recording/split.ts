import type {
  LayerRect,
  RecordedLayer,
  RecordedPointer,
} from "@goscreen/render-engine";

// "Devices separately": one take is cut into one recording per device. Each
// part is the device glass cropped out of the capture, with a journal of its
// own in which that glass fills the whole frame. The editor then opens it as
// a single-device recording: frame, touches and zooms all work.

export type TakeJournal = {
  version: 3;
  startedAt: number | null;
  mode: string;
  capture: { width: number; height: number };
  layers: RecordedLayer[];
  pointers: RecordedPointer[];
  devices: { id: string }[];
  events: unknown[];
  camera: unknown;
  pauses?: { start: number; end: number }[];
  chapters?: { url: string; start: number; end: number }[];
};

export type SplitPart = {
  suffix: string;
  rect: { x: number; y: number; width: number; height: number };
  journal: TakeJournal;
};

const FULL: Omit<LayerRect, "t"> = { x: 0, y: 0, width: 1, height: 1 };

/** Bounding box of every place the glass occupied during the take. */
export function glassBounds(rects: LayerRect[]): SplitPart["rect"] | null {
  if (rects.length === 0) return null;
  const x = Math.max(0, Math.min(...rects.map((r) => r.x)));
  const y = Math.max(0, Math.min(...rects.map((r) => r.y)));
  const right = Math.min(1, Math.max(...rects.map((r) => r.x + r.width)));
  const bottom = Math.min(1, Math.max(...rects.map((r) => r.y + r.height)));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "device";

/** One part per recorded glass. A take with a single device has nothing to split. */
export function splitParts(journal: TakeJournal): SplitPart[] {
  if (journal.layers.length < 2) return [];
  return journal.layers.flatMap((layer, i) => {
    const rect = glassBounds(layer.rects);
    if (!rect) return [];
    // Touches are already known in glass coordinates (u, v).
    const pointers = journal.pointers
      .filter(
        (p) =>
          p.instanceId === layer.instanceId &&
          p.u !== undefined &&
          p.v !== undefined,
      )
      .map((p) => ({ ...p, x: p.u as number, y: p.v as number }));
    return [
      {
        suffix: `dev${i + 1}-${slug(layer.deviceId)}`,
        rect,
        journal: {
          ...journal,
          mode: "device",
          capture: {
            width: Math.round(journal.capture.width * rect.width),
            height: Math.round(journal.capture.height * rect.height),
          },
          layers: [{ ...layer, rects: [{ t: 0, ...FULL }] }],
          pointers,
          devices: journal.devices.filter((d) => d.id === layer.instanceId),
        },
      },
    ];
  });
}
