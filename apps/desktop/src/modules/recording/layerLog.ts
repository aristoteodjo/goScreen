import type { LayerRect, RecordedLayer } from "@goscreen/render-engine";
import type { CaptureRegion } from "@/lib/ipc";
import { useProject } from "@/modules/studio/store/project";
import { screenElements, screenRect } from "./stagePoint";

const SAMPLE_MS = 200;
const EPSILON = 0.0005;

type Entry = Omit<RecordedLayer, "rects"> & { rects: LayerRect[] };

let region: CaptureRegion | null = null;
let entries = new Map<string, Entry>();
let timer: ReturnType<typeof setInterval> | null = null;

function overlaps(r: CaptureRegion, region: CaptureRegion) {
  return r.x < region.x + region.width && r.x + r.width > region.x && r.y < region.y + region.height && r.y + r.height > region.y;
}

const same = (a: LayerRect, b: Omit<LayerRect, "t">) =>
  Math.abs(a.x - b.x) < EPSILON &&
  Math.abs(a.y - b.y) < EPSILON &&
  Math.abs(a.width - b.width) < EPSILON &&
  Math.abs(a.height - b.height) < EPSILON;

/** Records where each device screen sits in the capture, whenever it moves. */
function sample(t: number) {
  if (!region) return;
  const devices = useProject.getState().devices;
  for (const [id, el] of screenElements()) {
    const box = screenRect(id);
    const device = devices.find((d) => d.id === id);
    if (!box || !device || !overlaps(box, region)) continue;
    const rect = {
      x: (box.x - region.x) / region.width,
      y: (box.y - region.y) / region.height,
      width: box.width / region.width,
      height: box.height / region.height,
    };
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        instanceId: id,
        deviceId: device.deviceId,
        colorId: device.colorId,
        orientation: device.orientation,
        screen: { width: el.offsetWidth, height: el.offsetHeight },
        source: device.source.kind,
        rotation: device.rotation,
        rects: [],
      };
      entries.set(id, entry);
    }
    const last = entry.rects[entry.rects.length - 1];
    if (!last || !same(last, rect)) entry.rects.push({ t: Math.max(0, t), ...rect });
  }
}

export const layerLog = {
  /** `clock` returns seconds since the first video frame. */
  start(capture: CaptureRegion, clock: () => number) {
    region = capture;
    entries = new Map();
    sample(clock());
    timer = setInterval(() => sample(clock()), SAMPLE_MS);
  },
  stop(): RecordedLayer[] {
    if (timer) clearInterval(timer);
    timer = null;
    region = null;
    const out = [...entries.values()].filter((e) => e.rects.length > 0);
    entries = new Map();
    return out;
  },
};
