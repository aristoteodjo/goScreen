import {
  type Block,
  BLOCKS,
  blockById,
  renderHtml,
  resolveProps,
} from "@goscreen/blocks";
import {
  type EditState,
  outputSize,
  type Overlay,
  parseEditState,
  type VideoOverlay,
} from "@goscreen/render-engine";
import { ipc } from "@/lib/ipc";
import { useSession } from "./session";
import { newId, useEdit, usePlayback } from "./store";

// Blocks (HTML compositions) become video layers: rendered frame by frame
// in headless Chrome, kept with their props so an edit renders them again.

const FPS = 30;
// Blocks render against a 1080p frame of the edit's format.
const LONG_SIDE = 1920;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Colours that match the film: its touch accent, and its text colour for
 * blocks whose text sits on the video (dark by default). A block that draws
 * text on its own panel (light by default) keeps its contrast.
 */
export function brandProps(
  edit: EditState,
  block?: Block,
): Record<string, string> {
  const text = edit.overlays.find((o) => o.kind === "text");
  const out: Record<string, string> = {};
  const has = (name: string) =>
    !block || block.props.some((p) => p.name === name);
  const darkInk = (name: string) =>
    !block ||
    block.props.some((p) => p.name === name && p.default === "#16241c");
  if (
    has("accent") &&
    /^#[0-9a-f]{6}$/i.test(edit.touch.color) &&
    edit.touch.color !== "#ffffff"
  )
    out.accent = edit.touch.color;
  if (text?.kind === "text" && darkInk("ink")) out.ink = text.style.color;
  return out;
}

export function pixelSize(
  edit: EditState,
  box: Box,
  source: { width: number; height: number } | null,
) {
  const out = outputSize(
    edit.aspect,
    source ?? { width: 1920, height: 1080 },
    LONG_SIDE,
  );
  return {
    width: Math.max(2, Math.round(box.width * out.width)),
    height: Math.max(2, Math.round(box.height * out.height)),
  };
}

type Rendered = { asset: EditState["assets"][number]; url: string };

/** Renders a block for a video and imports the result as an asset. */
export async function renderBlock(
  videoPath: string,
  edit: EditState,
  block: Block,
  props: Record<string, string | number>,
  box: Box,
  duration: number,
): Promise<Rendered> {
  const size = pixelSize(edit, box, useSession.getState().source);
  const file = await ipc.blockRender({
    html: renderHtml(block, props, size),
    width: size.width,
    height: size.height,
    fps: FPS,
    duration,
    transparent: block.transparent,
  });
  const asset = await ipc.assetImport(videoPath, file);
  if (useSession.getState().videoPath === videoPath)
    useSession.getState().addAssetUrl(asset.file, asset.url);
  return {
    asset: {
      id: asset.id,
      name: `${block.label} block`,
      kind: "video",
      file: asset.file,
      duration,
    },
    url: asset.url,
  };
}

/** A video layer that plays a rendered block. */
export function blockOverlay(
  block: Block,
  props: Record<string, string | number>,
  assetId: string,
  start: number,
  duration: number,
  box: Box,
  lane: number,
): VideoOverlay {
  return {
    id: newId("blk"),
    kind: "video",
    lane,
    start,
    duration,
    ...box,
    rotation: 0,
    opacity: 1,
    // The block animates itself; a plain cut in and a short fade out.
    enter: "none",
    exit: "fade",
    motion: 0.3,
    asset: assetId,
    in: 0,
    volume: 0,
    radius: 0,
    source: { block: block.id, props: resolveProps(block, props) },
  };
}

const freeLaneAt = (overlays: Overlay[], start: number, duration: number) => {
  for (let lane = 0; lane <= 20; lane++)
    if (
      !overlays.some(
        (o) =>
          o.lane === lane &&
          o.start < start + duration &&
          start < o.start + o.duration,
      )
    )
      return lane;
  return 20;
};

/** Adds a block to an edit; returns the new edit and the overlay id. */
export async function addBlock(
  videoPath: string,
  edit: EditState,
  blockId: string,
  props: Record<string, string | number>,
  start: number,
  place?: Partial<Box> & { duration?: number },
): Promise<{ edit: EditState; overlay: string }> {
  const block = blockById(blockId);
  if (!block) throw new Error(`Unknown block "${blockId}".`);
  const box = { ...block.box, ...place };
  const duration = place?.duration ?? block.duration;
  const merged = { ...brandProps(edit, block), ...props };
  const { asset } = await renderBlock(
    videoPath,
    edit,
    block,
    merged,
    box,
    duration,
  );
  const overlay = blockOverlay(
    block,
    merged,
    asset.id,
    start,
    duration,
    box,
    freeLaneAt(edit.overlays, start, duration),
  );
  const next = parseEditState({
    ...edit,
    assets: [...edit.assets, asset],
    overlays: [...edit.overlays, overlay],
  });
  if (!next) throw new Error("The block could not be added.");
  return { edit: next, overlay: overlay.id };
}

/** Renders a block layer again with new props (same place and timing). */
export async function updateBlock(
  videoPath: string,
  edit: EditState,
  overlayId: string,
  props: Record<string, string | number>,
): Promise<EditState> {
  const o = edit.overlays.find((x) => x.id === overlayId);
  if (o?.kind !== "video" || !o.source)
    throw new Error("This layer is not a block.");
  const block = blockById(o.source.block);
  if (!block) throw new Error(`Unknown block "${o.source.block}".`);
  const merged = { ...o.source.props, ...props };
  const { asset } = await renderBlock(
    videoPath,
    edit,
    block,
    merged,
    o,
    o.duration,
  );
  const next = parseEditState({
    ...edit,
    assets: [...edit.assets, asset],
    overlays: edit.overlays.map((x) =>
      x.id === o.id
        ? {
            ...o,
            asset: asset.id,
            source: { block: block.id, props: resolveProps(block, merged) },
          }
        : x,
    ),
  });
  if (!next) throw new Error("The block could not be updated.");
  return next;
}

/** In the open editor: add at the playhead, as one undoable change. */
export async function addBlockHere(
  blockId: string,
  props: Record<string, string | number>,
  at?: { x: number; y: number },
) {
  const { videoPath } = useSession.getState();
  const t = usePlayback.getState().time;
  const block = blockById(blockId);
  const place = at && block?.transparent ? { x: at.x, y: at.y } : undefined;
  const result = await addBlock(
    videoPath,
    useEdit.getState().edit,
    blockId,
    props,
    t,
    place,
  );
  useEdit.getState().change(() => result.edit, "block");
  usePlayback.getState().select({ kind: "overlay", id: result.overlay });
}

export { BLOCKS };
