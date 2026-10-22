import {
  type Composition,
  compositionFromBlock,
  describeIssues,
  parseComposition,
  prepareCompositionHtml,
  renderFingerprint,
  resolveCompositionProps,
  sceneFor,
} from "@goscreen/blocks";
import {
  type EditState,
  outputSize,
  parseEditState,
  type VideoOverlay,
} from "@goscreen/render-engine";
import { useQuery } from "@tanstack/react-query";
import { compositionsIpc, ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { brandProps, freeLaneAt, given, pixelSize, sourceOf } from "./blocks";
import { useSession } from "./session";
import { newId, useEdit, usePlayback } from "./store";

// Compositions (HTML pages written by an AI or a person) become video layers
// the same way blocks do. The page is kept with the montage
// (`<stem>.assets/compositions/<id>.json`) or in the project library, and the
// layer keeps `{ composition, props }` to render it again.

const FPS = 30;
const LONG_SIDE = 1920;

type Box = { x: number; y: number; width: number; height: number };

export const compositionsKey = (videoPath: string) => [
  "compositions",
  videoPath,
];

export type CompositionList = {
  video: Composition[];
  library: Composition[];
  project: boolean;
};

const valid = (docs: unknown[]) =>
  docs.flatMap((d) => {
    const r = parseComposition(d);
    return r.ok ? [r.composition] : [];
  });

/** Compositions of a video, those of its montage first; invalid files are skipped. */
export async function loadCompositions(
  videoPath: string,
): Promise<CompositionList> {
  const r = await compositionsIpc.list(videoPath);
  return {
    video: valid(r.video),
    library: valid(r.library),
    project: r.project,
  };
}

export function useCompositions(videoPath: string) {
  return useQuery({
    queryKey: compositionsKey(videoPath),
    queryFn: () => loadCompositions(videoPath),
    enabled: videoPath.length > 0,
  });
}

export const refreshCompositions = (videoPath: string) =>
  queryClient.invalidateQueries({ queryKey: compositionsKey(videoPath) });

/**
 * A composition by id: the montage's copy first, then the project library,
 * then a built-in scene (fitted to the montage's format).
 */
export async function findComposition(
  videoPath: string,
  id: string,
  aspect: EditState["aspect"] = "16:9",
): Promise<Composition> {
  const all = await loadCompositions(videoPath);
  const found =
    all.video.find((c) => c.id === id) ??
    all.library.find((c) => c.id === id) ??
    sceneFor(id, aspect);
  if (!found)
    throw new Error(
      `No composition "${id}" in this video, its project or the scenes (compositions.list).`,
    );
  return found;
}

/** Checks a composition; throws with every issue and its path. */
export function checkComposition(raw: unknown): Composition {
  const r = parseComposition(raw);
  if (!r.ok)
    throw new Error(`Invalid composition: ${describeIssues(r.issues)}`);
  return r.composition;
}

/** Keeps a composition with the montage (or in the project library). */
export async function saveComposition(
  videoPath: string,
  composition: Composition,
  library = false,
) {
  await compositionsIpc.save(videoPath, composition.id, composition, library);
  await refreshCompositions(videoPath);
}

/**
 * The default box of a composition on the frame: its natural size against
 * the output, centred, never larger than the frame.
 */
export function defaultBox(
  edit: EditState,
  c: Composition,
  source: { width: number; height: number } | null,
): Box {
  const out = outputSize(
    edit.aspect,
    source ?? { width: 1920, height: 1080 },
    LONG_SIDE,
  );
  const scale = Math.min(1, out.width / c.box.width, out.height / c.box.height);
  return {
    x: 0.5,
    y: 0.5,
    width: (c.box.width * scale) / out.width,
    height: (c.box.height * scale) / out.height,
  };
}

/** The props an AI or the dialog may not have set: the film's colours. */
export function compositionBrand(
  edit: EditState,
  c: Composition,
): Record<string, string> {
  const brand = brandProps(edit);
  const out: Record<string, string> = {};
  for (const p of c.props)
    if (p.type === "color" && brand[p.name]) out[p.name] = brand[p.name];
  return out;
}

// Same page, same size and length: the asset already imported in this
// session is reused instead of another copy of the same file.
const imported = new Map<string, string>();

type Rendered = { asset: EditState["assets"][number] };

/** Renders a composition for a video and imports the result as an asset. */
export async function renderComposition(
  videoPath: string,
  edit: EditState,
  c: Composition,
  props: Record<string, string | number>,
  box: Box,
  duration: number,
): Promise<Rendered> {
  const size = pixelSize(edit, box, sourceOf(edit));
  const job = {
    html: prepareCompositionHtml(c, props, size),
    width: size.width,
    height: size.height,
    fps: FPS,
    duration,
    transparent: c.transparent,
  };
  const key = `${videoPath}\n${renderFingerprint(job)}`;
  const known = imported.get(key);
  const existing = known && edit.assets.find((a) => a.id === known);
  if (existing) return { asset: existing };
  // The page may show the montage's own assets, by name.
  const file = await ipc.blockRender({ ...job, video: videoPath });
  const asset = await ipc.assetImport(videoPath, file);
  if (useSession.getState().videoPath === videoPath)
    useSession.getState().addAssetUrl(asset.file, asset.url);
  imported.set(key, asset.id);
  return {
    asset: {
      id: asset.id,
      name: `${c.label} composition`,
      kind: "video",
      file: asset.file,
      duration,
    },
  };
}

/** One still of a composition at t, as base64 JPEG (no layer, no asset). */
export async function previewComposition(
  edit: EditState,
  c: Composition,
  props: Record<string, string | number>,
  t: number,
  videoPath?: string,
): Promise<string> {
  const size = {
    width: Math.min(1920, c.box.width),
    height: Math.min(1920, c.box.height),
  };
  return ipc.blockFrame({
    html: prepareCompositionHtml(
      c,
      { ...compositionBrand(edit, c), ...props },
      size,
    ),
    width: size.width,
    height: size.height,
    t: Math.min(Math.max(0, t), c.duration),
    transparent: c.transparent,
    video: videoPath,
  });
}

function compositionOverlay(
  c: Composition,
  props: Record<string, string | number>,
  assetId: string,
  start: number,
  duration: number,
  box: Box,
  lane: number,
): VideoOverlay {
  return {
    id: newId("cmp"),
    kind: "video",
    lane,
    start,
    duration,
    ...box,
    rotation: 0,
    opacity: 1,
    enter: "none",
    exit: "fade",
    motion: 0.3,
    asset: assetId,
    in: 0,
    volume: 0,
    radius: 0,
    source: { composition: c.id, props: resolveCompositionProps(c, props) },
  };
}

const withAsset = (edit: EditState, asset: EditState["assets"][number]) =>
  edit.assets.some((a) => a.id === asset.id)
    ? edit.assets
    : [...edit.assets, asset];

/** Files of scene layers laid out but not rendered yet (`@goscreen/campaign`). */
const PENDING_EXT = ".pending";

/**
 * Renders every scene layer laid out but not rendered yet (what a dynamic
 * recipe or a reference montage writes): a video layer whose source names a
 * composition and whose asset file ends with `.pending`. Each one is rendered
 * at its own box and length, like `edit.addComposition`, and its placeholder
 * asset replaced. `screen: "recording"` on a scene means a frame of the take
 * at `screenAt` (source seconds), cut from the recording; without a recording
 * the scene draws its stand-in interface.
 */
export async function renderPendingScenes(
  videoPath: string,
  edit: EditState,
  hasRecording: boolean,
): Promise<{ edit: EditState; rendered: number }> {
  const pending = new Set(
    edit.assets.filter((a) => a.file.endsWith(PENDING_EXT)).map((a) => a.id),
  );
  if (pending.size === 0) return { edit, rendered: 0 };
  let next = edit;
  let rendered = 0;
  for (const o of edit.overlays) {
    if (o.kind !== "video" || !pending.has(o.asset)) continue;
    if (!o.source || !("composition" in o.source)) continue;
    // A scene laid out by a recipe is the built-in one as this app ships it
    // (a copy kept with the montage by an earlier render may be out of date).
    const c =
      sceneFor(o.source.composition, edit.aspect) ??
      (await findComposition(videoPath, o.source.composition, edit.aspect));
    const props: Record<string, string | number> = {
      ...compositionBrand(edit, c),
      ...o.source.props,
    };
    if (props.screen === "recording") {
      const at = Number(props.screenAt ?? 0);
      props.screen = hasRecording
        ? (
            await ipc.recordingCrop(videoPath, Number.isFinite(at) ? at : 0, {
              x: 0,
              y: 0,
              w: 1,
              h: 1,
            })
          ).file
        : "";
    }
    delete props.screenAt;
    await compositionsIpc.save(videoPath, c.id, c, false);
    const { asset } = await renderComposition(
      videoPath,
      next,
      c,
      props,
      { x: o.x, y: o.y, width: o.width, height: o.height },
      o.duration,
    );
    next = {
      ...next,
      assets: [
        ...next.assets.filter((a) => a.id !== o.asset && a.id !== asset.id),
        asset,
      ],
      overlays: next.overlays.map((x) =>
        x.id === o.id && x.kind === "video"
          ? { ...x, asset: asset.id, source: { composition: c.id, props } }
          : x,
      ),
    };
    rendered++;
  }
  await refreshCompositions(videoPath);
  return { edit: next, rendered };
}

/**
 * Adds a composition to an edit: the page is checked, kept with the montage
 * (so the layer can be rendered again later), rendered and placed.
 */
export async function addComposition(
  videoPath: string,
  edit: EditState,
  composition: Composition,
  props: Record<string, string | number>,
  start: number,
  place?: Partial<Box> & { duration?: number },
): Promise<{ edit: EditState; overlay: string }> {
  const c = checkComposition(composition);
  await saveComposition(videoPath, c);
  const box = {
    ...defaultBox(edit, c, sourceOf(edit)),
    ...given(place),
  };
  const duration = place?.duration ?? c.duration;
  const merged = { ...compositionBrand(edit, c), ...props };
  const { asset } = await renderComposition(
    videoPath,
    edit,
    c,
    merged,
    box,
    duration,
  );
  const overlay = compositionOverlay(
    c,
    merged,
    asset.id,
    start,
    duration,
    box,
    freeLaneAt(edit.overlays, start, duration),
  );
  const next = parseEditState({
    ...edit,
    assets: withAsset(edit, asset),
    overlays: [...edit.overlays, overlay],
  });
  if (!next) throw new Error("The composition could not be added.");
  return { edit: next, overlay: overlay.id };
}

/**
 * Renders a composition layer again: new props, and/or a new page (the
 * montage's copy of the composition is updated), same place and timing.
 */
export async function updateComposition(
  videoPath: string,
  edit: EditState,
  overlayId: string,
  change: {
    props?: Record<string, string | number>;
    composition?: Composition;
  },
): Promise<EditState> {
  const o = edit.overlays.find((x) => x.id === overlayId);
  if (o?.kind !== "video" || !o.source || !("composition" in o.source))
    throw new Error("This layer is not a composition.");
  let c = change.composition
    ? checkComposition(change.composition)
    : await findComposition(videoPath, o.source.composition, edit.aspect);
  if (change.composition) {
    c = { ...c, id: o.source.composition };
    await saveComposition(videoPath, c);
  }
  const merged = { ...o.source.props, ...(change.props ?? {}) };
  const { asset } = await renderComposition(
    videoPath,
    edit,
    c,
    merged,
    o,
    o.duration,
  );
  const next = parseEditState({
    ...edit,
    assets: withAsset(edit, asset),
    overlays: edit.overlays.map((x) =>
      x.id === o.id
        ? {
            ...o,
            asset: asset.id,
            source: {
              composition: c.id,
              props: resolveCompositionProps(c, merged),
            },
          }
        : x,
    ),
  });
  if (!next) throw new Error("The composition could not be updated.");
  return next;
}

/**
 * A block layer becomes a composition layer: its page, with the current
 * props inlined, is kept with the montage and can be edited by hand.
 */
export async function convertBlockLayer(
  videoPath: string,
  edit: EditState,
  overlayId: string,
  block: Parameters<typeof compositionFromBlock>[0],
): Promise<{ edit: EditState; composition: Composition }> {
  const o = edit.overlays.find((x) => x.id === overlayId);
  if (o?.kind !== "video" || !o.source || !("block" in o.source))
    throw new Error("This layer is not a block.");
  const size = pixelSize(edit, o, sourceOf(edit));
  const taken = new Set(
    (await loadCompositions(videoPath)).video.map((c) => c.id),
  );
  let id = `${block.id}-custom`;
  for (let n = 2; taken.has(id); n++) id = `${block.id}-custom-${n}`;
  const c = compositionFromBlock(block, o.source.props, size, id);
  await saveComposition(videoPath, c);
  const next = parseEditState({
    ...edit,
    overlays: edit.overlays.map((x) =>
      x.id === o.id ? { ...o, source: { composition: c.id, props: {} } } : x,
    ),
  });
  if (!next) throw new Error("The block could not be converted.");
  return { edit: next, composition: c };
}

/** In the open editor: add at the playhead, as one undoable change. */
export async function addCompositionHere(
  composition: Composition,
  props: Record<string, string | number>,
  at?: { x: number; y: number },
) {
  const { videoPath } = useSession.getState();
  const t = usePlayback.getState().time;
  const place =
    at && composition.transparent ? { x: at.x, y: at.y } : undefined;
  const result = await addComposition(
    videoPath,
    useEdit.getState().edit,
    composition,
    props,
    t,
    place,
  );
  useEdit.getState().change(() => result.edit, "composition");
  usePlayback.getState().select({ kind: "overlay", id: result.overlay });
}
