import { activeZoom, autoFocus, cameraAt } from "./camera";
import { cursorAt } from "./cursor";
import {
  layerPoint,
  placeLayer,
  rectAt,
  stageArea,
  webcamRect,
} from "./layers";
import { contentRect } from "./layout";
import {
  AT_REST,
  driftAt,
  entranceAt,
  focalLength,
  isFlat,
  type Pose,
  projectRect,
} from "./look";
import { placeClips, sourceTimeAt } from "./sequence";
import {
  FLAT,
  type Press,
  pressPunch,
  presses,
  ripplesAt,
  spotlightAt,
  touchesAt,
} from "./touches";
import { transitionAt } from "./transitions";
import { activeOverlays, overlayMotion } from "./motion";
import type {
  EditState,
  Frame,
  FrameGeometry,
  LayerEdit,
  MainClip,
  PlacedLayer,
  Point,
  RecordedLayer,
  RecordedPointer,
  Rect,
  Size,
} from "./types";

/** Resolves a device frame's geometry (the Device Engine, injected). */
export type GeometryOf = (
  edit: LayerEdit,
  recorded: RecordedLayer,
) => FrameGeometry | null;

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

/**
 * Where source time t sits in its scene: seconds since the scene opened and
 * the scene's length. A scene is a clip that opens a new view (first clip,
 * after a card or a transition); plain cuts inside a take are not scenes.
 */
export type SceneTime = { local: number; length: number; opens: boolean };

/** The scene around timeline time t, or null on a card. */
export function sceneTimeAt(clips: MainClip[], t: number): SceneTime | null {
  const placed = placeClips(clips);
  if (placed.length === 0) return null;
  const i = Math.max(
    0,
    placed.findIndex((p) => t < p.end) === -1
      ? placed.length - 1
      : placed.findIndex((p) => t < p.end),
  );
  const here = placed[i];
  if (here.clip.kind !== "recording") return null;
  // A scene starts at this clip when it opens a new view: the first clip,
  // one after a card, or one that comes in with a transition.
  let first = i;
  while (first > 0) {
    const prev = placed[first - 1].clip;
    if (prev.kind !== "recording" || placed[first].clip.transition) break;
    first -= 1;
  }
  let last = i;
  while (last + 1 < placed.length) {
    const next = placed[last + 1].clip;
    if (next.kind !== "recording" || next.transition) break;
    last += 1;
  }
  return {
    local: t - placed[first].start,
    length: placed[last].end - placed[first].start,
    opens: true,
  };
}

/** Lean, pose and depth of a placed layer at this moment of the scene. */
function presentLayer(
  layer: PlacedLayer,
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  scene: SceneTime | null,
): PlacedLayer {
  const look = edit.screen;
  const pose: Pose =
    look.entrance && scene?.opens ? entranceAt(scene.local) : AT_REST;
  const drift = scene ? driftAt(scene.local, scene.length, look.drift) : 0;
  const punch =
    edit.touch.style === "none"
      ? 1
      : pressPunch(timeline.presses, t, layer.instanceId);
  if (isFlat(look) && pose === AT_REST && punch === 1) return layer;
  const tilt = { x: look.tilt.x + pose.tiltX, y: look.tilt.y + drift };
  const center = {
    x: layer.center.x,
    y: layer.center.y + pose.dy * output.height,
  };
  const scale = layer.scale * pose.scale * punch;
  const { quad, z } = projectRect(
    center,
    {
      width: layer.geometry.frame.width * scale,
      height: layer.geometry.frame.height * scale,
    },
    layer.rotation,
    tilt,
    focalLength(output),
  );
  return {
    ...layer,
    center,
    scale,
    quad,
    depth: z,
    tilt,
    opacity: pose.opacity,
  };
}

function placeLayers(
  edit: EditState,
  timeline: Timeline,
  area: Rect,
  t: number,
  output: Size,
  scene: SceneTime | null,
): PlacedLayer[] {
  const out: PlacedLayer[] = [];
  for (const le of edit.layers ?? []) {
    if (le.hidden) continue;
    const recorded = timeline.layers.find(
      (l) => l.instanceId === le.instanceId,
    );
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
    out.push(
      presentLayer(
        placeLayer(le, geometry, area, crop),
        edit,
        timeline,
        output,
        t,
        scene,
      ),
    );
  }
  return out;
}

/**
 * The single description of an output frame at source time t. Preview and
 * export both draw from this, so what you see is what gets exported.
 */
export function composeFrame(
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  scene: SceneTime | null = null,
): Frame {
  const area = stageArea(output, edit.camera, timeline.hasCamera);
  const webcam = webcamRect(output, edit.camera, timeline.hasCamera);
  const layered = edit.layers !== null && timeline.layers.length > 0;

  let content: Rect = area;
  let layers: PlacedLayer[] = [];
  let flat: PlacedLayer | null = null;
  let toOutput: (p: RecordedPointer) => Point | null;

  if (layered) {
    layers = placeLayers(edit, timeline, area, t, output, scene);
    toOutput = (p) => {
      const layer = layers.find((l) => l.instanceId === p.instanceId);
      if (!layer || p.u === undefined || p.v === undefined) return null;
      return layerPoint(layer, p.u, p.v);
    };
  } else {
    const inner = contentRect(
      area,
      timeline.source,
      edit.background.kind === "none" ? 0 : edit.padding,
    );
    content = { ...inner, x: inner.x + area.x, y: inner.y + area.y };
    // The video as one glass, when the screen look asks for it.
    const glass = presentLayer(flatLayer(content), edit, timeline, output, t, scene);
    flat = glass.tilt.x !== 0 || glass.tilt.y !== 0 || glass.scale !== 1 ||
      glass.opacity !== 1 || glass.center.y !== content.y + content.height / 2
      ? glass
      : null;
    const here = flat;
    toOutput = here
      ? (p) => layerPoint(here, p.x, p.y)
      : (p) => ({
          x: content.x + p.x * content.width,
          y: content.y + p.y * content.height,
        });
  }

  const seg = activeZoom(edit.zooms, t);
  const focus = seg
    ? seg.focus
      ? { x: seg.focus.x * output.width, y: seg.focus.y * output.height }
      : autoFocus(timeline.pointers, seg, t, toOutput)
    : null;
  const camera = cameraAt(seg, t, output, focus);

  const touches =
    edit.touch.style === "none"
      ? []
      : edit.touch.style === "ripple"
        ? ripplesAt(timeline.presses, t, toOutput)
        : touchesAt(timeline.presses, t, toOutput);

  const cursor = edit.cursor.visible
    ? cursorAt(timeline.pointers, timeline.presses, t, toOutput)
    : null;

  const spotlight =
    (edit.touch.spotlight ?? 0) > 0 && edit.touch.style !== "none"
      ? spotlightAt(timeline.presses, t, toOutput)
      : null;

  return {
    output,
    content,
    layers,
    flat,
    camera,
    touches,
    spotlight,
    cursor,
    webcam,
  };
}

/** A flat video's rectangle as a frameless layer at scale 1 (output px). */
function flatLayer(content: Rect): PlacedLayer {
  const geometry = {
    frame: { width: content.width, height: content.height },
    screen: { x: 0, y: 0, width: content.width, height: content.height },
  };
  const center = {
    x: content.x + content.width / 2,
    y: content.y + content.height / 2,
  };
  return {
    instanceId: FLAT,
    center,
    scale: 1,
    rotation: 0,
    geometry,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    frame: false,
    quad: [
      { x: content.x, y: content.y },
      { x: content.x + content.width, y: content.y },
      { x: content.x + content.width, y: content.y + content.height },
      { x: content.x, y: content.y + content.height },
    ],
    depth: [0, 0, 0, 0],
    tilt: { x: 0, y: 0 },
    opacity: 1,
  };
}

/**
 * Whether the picture moves around timeline time t (over `dt` seconds):
 * the camera, a leaning or entering screen, a transition, an overlay in
 * motion. The export then accumulates sub-frames for motion blur.
 */
export function frameMoves(
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  dt: number,
): boolean {
  return frameMotion(edit, timeline, output, t, dt) > 0;
}

/**
 * How far the picture moves over `dt` seconds around t, in output px (the
 * largest displacement of the camera or a screen corner); transitions and
 * overlays in motion count as a full frame's worth. 0 = still.
 */
export function frameMotion(
  edit: EditState,
  timeline: Timeline,
  output: Size,
  t: number,
  dt: number,
): number {
  const short = Math.min(output.width, output.height);
  if (transitionAt(edit.clips, t)) return short * 0.02;
  for (const o of activeOverlays(edit.overlays, t)) {
    const local = t - o.start;
    const span = Math.min(o.motion, o.duration / 2);
    if (local < span || local > o.duration - span) {
      const a = overlayMotion(o, t - dt / 2);
      const b = overlayMotion(o, t + dt / 2);
      if (a.dx !== b.dx || a.dy !== b.dy || a.scale !== b.scale)
        return short * 0.02;
    }
    if (o.keyframes && Object.values(o.keyframes).some((k) => k && k.length > 1))
      return short * 0.02;
  }
  const a = sourceTimeAt(edit.clips, t - dt / 2);
  const b = sourceTimeAt(edit.clips, t + dt / 2);
  if (a === null || b === null) return 0;
  const fa = composeFrame(edit, timeline, output, a, sceneTimeAt(edit.clips, t - dt / 2));
  const fb = composeFrame(edit, timeline, output, b, sceneTimeAt(edit.clips, t + dt / 2));
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  // Where the camera's window corner lands: scale and centre together.
  const corner = (f: Frame) => ({
    x: (0 - f.camera.center.x) * f.camera.scale,
    y: (0 - f.camera.center.y) * f.camera.scale,
  });
  let motion = dist(corner(fa), corner(fb));
  for (let i = 0; i < fa.layers.length; i += 1) {
    const la = fa.layers[i];
    const lb = fb.layers[i];
    if (!lb) return short * 0.02;
    for (let k = 0; k < 4; k += 1)
      motion = Math.max(motion, dist(la.quad[k], lb.quad[k]) * fa.camera.scale);
  }
  return motion > 0.75 ? motion : 0;
}
