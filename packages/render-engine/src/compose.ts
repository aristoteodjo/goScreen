import { activeZoom, autoFocus, cameraAt } from "./camera";
import { contentRect } from "./layout";
import { layerPoint, placeLayer, rectAt, stageArea, webcamRect } from "./layers";
import { type Press, presses, touchesAt } from "./touches";
import type {
  EditState,
  Frame,
  FrameGeometry,
  LayerEdit,
  PlacedLayer,
  Point,
  RecordedLayer,
  RecordedPointer,
  Rect,
  Size,
} from "./types";

/** Resolves a device frame's geometry (the Device Engine, injected). */
export type GeometryOf = (edit: LayerEdit, recorded: RecordedLayer) => FrameGeometry | null;

export type Timeline = {
  source: Size;
  pointers: RecordedPointer[];
  presses: Press[];
  layers: RecordedLayer[];
  hasCamera: boolean;
  geometry: GeometryOf;
};

export function timelineOf(
  source: Size,
  pointers: RecordedPointer[],
  extra: Partial<Pick<Timeline, "layers" | "hasCamera" | "geometry">> = {},
): Timeline {
  return {
    source,
    pointers,
    presses: presses(pointers),
    layers: extra.layers ?? [],
    hasCamera: extra.hasCamera ?? false,
    geometry: extra.geometry ?? (() => null),
  };
}

function placeLayers(edit: EditState, timeline: Timeline, area: Rect, t: number): PlacedLayer[] {
  const out: PlacedLayer[] = [];
  for (const le of edit.layers ?? []) {
    const recorded = timeline.layers.find((l) => l.instanceId === le.instanceId);
    if (!recorded) continue;
    const geometry = timeline.geometry(le, recorded);
    const r = rectAt(recorded.rects, t);
    if (!geometry || !r) continue;
    const crop = {
      x: r.x * timeline.source.width,
      y: r.y * timeline.source.height,
      width: r.width * timeline.source.width,
      height: r.height * timeline.source.height,
    };
    out.push(placeLayer(le, geometry, area, crop));
  }
  return out;
}

/**
 * The single description of an output frame at source time t. Preview and
 * export both draw from this, so what you see is what gets exported.
 */
export function composeFrame(edit: EditState, timeline: Timeline, output: Size, t: number): Frame {
  const area = stageArea(output, edit.camera, timeline.hasCamera);
  const webcam = webcamRect(output, edit.camera, timeline.hasCamera);
  const layered = edit.layers !== null && timeline.layers.length > 0;

  let content: Rect = area;
  let layers: PlacedLayer[] = [];
  let toOutput: (p: RecordedPointer) => Point | null;

  if (layered) {
    layers = placeLayers(edit, timeline, area, t);
    toOutput = (p) => {
      const layer = layers.find((l) => l.instanceId === p.instanceId);
      if (!layer || p.u === undefined || p.v === undefined) return null;
      return layerPoint(layer, p.u, p.v);
    };
  } else {
    const inner = contentRect(area, timeline.source, edit.background.kind === "none" ? 0 : edit.padding);
    content = { ...inner, x: inner.x + area.x, y: inner.y + area.y };
    toOutput = (p) => ({ x: content.x + p.x * content.width, y: content.y + p.y * content.height });
  }

  const seg = activeZoom(edit.zooms, t);
  const focus = seg
    ? seg.focus
      ? { x: seg.focus.x * output.width, y: seg.focus.y * output.height }
      : autoFocus(timeline.pointers, seg, t, toOutput)
    : null;
  const camera = cameraAt(seg, t, output, focus);

  const touches = edit.touch.style === "none" ? [] : touchesAt(timeline.presses, t, toOutput);

  return { output, content, layers, camera, touches, webcam };
}
