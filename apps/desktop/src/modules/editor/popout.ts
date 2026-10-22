import {
  composeFrame,
  type EditState,
  type GlassRect,
  outputSize,
  POP_DEFAULTS,
  popBox,
  popOutOverlay,
  rectAt,
  sceneTimeAt,
  timelineTimesOf,
} from "@goscreen/render-engine";
import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { currentTimeline, useSession } from "./session";
import { newId, useEdit } from "./store";

// Pop-out: a rectangle of a device screen, at one instant of the take,
// becomes an image layer that leaves the screen and floats in front. The
// pixels are cut out by FFmpeg (Rust) into the take's assets; the layer is
// placed exactly where the rectangle sits on the output at that instant, and
// its rise, shadow and glow are ordinary keyframes and fields.

export type PopOutRequest = {
  // Source seconds.
  t: number;
  // The device's instance id, or null for a flat recording.
  layer: string | null;
  rect: GlassRect;
  duration?: number;
  lift?: number;
};

/** The accent the film draws its emphasis with: the touch colour. */
const accentOf = (edit: EditState) => {
  const film = edit.film?.settings as { accent?: unknown } | undefined;
  return typeof film?.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(film.accent)
    ? film.accent
    : edit.touch.color;
};

/** First lane free over [start, start + duration). */
function freeLane(edit: EditState, start: number, duration: number) {
  for (let lane = 0; lane < 20; lane += 1)
    if (
      !edit.overlays.some(
        (o) =>
          o.lane === lane &&
          o.start < start + duration &&
          start < o.start + o.duration,
      )
    )
      return lane;
  return 0;
}

/**
 * Cuts the rectangle out of the open recording and builds the floating
 * layer for it, against the montage on screen; nothing is applied yet.
 */
export async function cutPopOut(req: PopOutRequest) {
  const session = useSession.getState();
  const timeline = currentTimeline();
  if (!session.videoPath || !session.source || !timeline || !session.videoUrl)
    throw new Error("Pop-out needs an open recording.");
  const edit = useEdit.getState().edit;
  const starts = timelineTimesOf(edit.clips, req.t);
  if (starts.length === 0)
    throw new Error(
      `Source time ${req.t.toFixed(2)} s is not shown by any clip of the timeline.`,
    );
  const start = starts[0];
  const output = outputSize(edit.aspect, session.source);
  const frame = composeFrame(
    edit,
    timeline,
    output,
    req.t,
    sceneTimeAt(edit.clips, start),
  );
  const layered = edit.layers !== null && timeline.layers.length > 0;
  const layer = layered
    ? (req.layer ?? frame.layers[0]?.instanceId ?? null)
    : null;
  if (layered && !layer) throw new Error("No device is shown at that time.");
  const box = popBox(frame, layer, req.rect);
  if (!box) throw new Error("That rectangle is not on a visible screen.");

  // Where the glass sits in the source video: the whole frame for a flat
  // take, the layer's crop otherwise (fractions of the frame).
  const recorded = layer
    ? timeline.layers.find((l) => l.instanceId === layer)
    : null;
  const crop = recorded ? rectAt(recorded.rects, req.t) : null;
  const glass = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x = clamp(glass.x + req.rect.u * glass.width);
  const y = clamp(glass.y + req.rect.v * glass.height);
  const source = {
    x,
    y,
    w: clamp(glass.x + (req.rect.u + req.rect.w) * glass.width) - x,
    h: clamp(glass.y + (req.rect.v + req.rect.h) * glass.height) - y,
  };
  const asset = await ipc.recordingCrop(session.videoPath, req.t, source);
  useSession.getState().addAssetUrl(asset.file, asset.url);

  const duration = req.duration ?? POP_DEFAULTS.duration;
  const id = newId("pop");
  const overlay = popOutOverlay({
    id,
    asset: asset.id,
    lane: freeLane(edit, start, duration),
    start,
    duration,
    box,
    lift: req.lift,
    glow: accentOf(edit),
  });
  const record = {
    id: asset.id,
    name: asset.name,
    kind: "image" as const,
    file: asset.file,
    duration: null,
  };
  return { overlay, asset: record, start, duration, box };
}

/**
 * Pops a rectangle of the glass out: cuts the pixels, then adds the asset
 * and the floating layer in one undoable change. Returns the layer's id
 * and where it sits.
 */
export async function popOut(req: PopOutRequest) {
  const cut = await cutPopOut(req);
  useEdit.getState().change((ed) => ({
    ...ed,
    assets: [...ed.assets, cut.asset],
    overlays: [...ed.overlays, cut.overlay],
  }));
  return {
    overlay: cut.overlay.id,
    asset: cut.asset.id,
    start: cut.start,
    duration: cut.duration,
    box: cut.box,
  };
}

// The "Pop out…" tool of the preview: armed from the menu, the next drag on
// the preview draws the rectangle to pop out.
type PopOutTool = {
  armed: boolean;
  arm: () => void;
  disarm: () => void;
};

export const usePopOutTool = create<PopOutTool>((set) => ({
  armed: false,
  arm: () => set({ armed: true }),
  disarm: () => set({ armed: false }),
}));
