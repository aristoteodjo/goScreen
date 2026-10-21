import { DEFAULT_LOOK } from "./look";
import { outputSize } from "./layout";
import { sequenceDuration } from "./sequence";
import type { AspectId, BlankSource, EditState, SlideClip } from "./types";

// A montage without a recording: its main track is cards only, and
// everything else is layers (text, blocks, compositions, media) and sound.
// It starts from a blank frame, like a Remotion composition.

/** Formats a blank montage can be made in (never "auto": nothing to follow). */
export type BlankAspect = Exclude<AspectId, "auto">;

export const BLANK_DEFAULTS = {
  aspect: "16:9" as BlankAspect,
  duration: 20,
  background: "#0f1115",
};

/** A blank montage's source: the 1080p frame of its format. */
/** A warm accent a montage without a film starts with (never white on white). */
export const BLANK_ACCENT = "#e8613c";

export function blankSource(aspect: AspectId): BlankSource {
  const chosen: BlankAspect =
    aspect === "auto" ? BLANK_DEFAULTS.aspect : aspect;
  return { kind: "none", ...outputSize(chosen, { width: 16, height: 9 }) };
}

export const isBlank = (edit: Pick<EditState, "source">): boolean =>
  edit.source?.kind === "none";

/** The one card a blank montage starts with (and falls back to). */
export function blankSlide(
  duration: number,
  background = BLANK_DEFAULTS.background,
  id = "slide-1",
): SlideClip {
  return {
    id,
    kind: "slide",
    duration: Math.max(0.2, duration),
    background: { kind: "color", value: background },
    title: "",
    subtitle: "",
    color: "#ffffff",
    font: "Inter",
    animation: "none",
    transition: null,
  };
}

/** A fresh montage without a recording: one plain card of `duration` seconds. */
export function blankEdit(o: {
  aspect?: BlankAspect;
  duration?: number;
  background?: string;
}): EditState {
  const aspect = o.aspect ?? BLANK_DEFAULTS.aspect;
  const background = o.background ?? BLANK_DEFAULTS.background;
  return {
    version: 2,
    source: blankSource(aspect),
    aspect,
    background: { kind: "color", value: background },
    padding: 0,
    radius: 0,
    shadow: 0,
    clips: [blankSlide(o.duration ?? BLANK_DEFAULTS.duration, background)],
    overlays: [],
    audio: [],
    assets: [],
    zooms: [],
    // The touch colour doubles as the accent of texts (*words*) and blocks.
    touch: { style: "none", color: BLANK_ACCENT, size: 44 },
    cursor: { visible: false, size: 28 },
    sound: { clicks: false, volume: 0.6 },
    layers: [],
    camera: {
      visible: false,
      layout: "overlay",
      corner: 8,
      size: 0.22,
      shape: "rounded",
      mirror: true,
    },
    mic: { volume: 1 },
    tracks: { hidden: [], muted: [], micMuted: false },
    screen: DEFAULT_LOOK,
  };
}

/**
 * Where the montage ends. A recording's montage ends with its main track
 * (layers past it are not shown). A blank montage ends with its last card
 * or layer or sound, whichever is later: a layer placed after the cards
 * still plays, on the montage's background.
 */
export function montageEnd(edit: EditState): number {
  const clips = sequenceDuration(edit.clips);
  if (!isBlank(edit)) return clips;
  const items = [...edit.overlays, ...edit.audio];
  return items.reduce((end, i) => Math.max(end, i.start + i.duration), clips);
}
