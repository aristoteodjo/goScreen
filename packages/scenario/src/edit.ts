import {
  buildAutoZooms,
  type Chapter,
  DEFAULT_EDIT,
  type EditState,
  type Overlay,
  type RecordedLayer,
  type RecordedPointer,
  type RecordingClip,
  type SlideClip,
  type ZoomSegment,
} from "@goscreen/render-engine";
import type { Film } from "./scenario";

export type Take = {
  chapters: Chapter[];
  pointers: RecordedPointer[];
  layers: RecordedLayer[];
  // Source length in seconds.
  duration: number;
};

/** French puts a no-break space before ? ! : ; (so they never start a line). */
export function typeset(text: string, locale: string): string {
  if (!locale.toLowerCase().startsWith("fr")) return text;
  return text.replace(/\s+([?!:;])/g, " $1").replace(/«\s+/g, "« ");
}

const CARD_FADE = { kind: "fade" as const, duration: 0.35 };

function card(
  id: string,
  film: Film,
  c: NonNullable<Film["intro"]>,
  locale: string,
): SlideClip {
  return {
    id,
    kind: "slide",
    transition: CARD_FADE,
    duration: c.duration,
    background: { kind: "color", value: film.background },
    title: typeset(c.title, locale),
    subtitle: typeset(c.subtitle, locale),
    color: film.ink,
    font: film.font,
    animation: "words",
  };
}

/** The scenes of a take: chapters with a caption (a cut leaves a gap). */
export function scenesOf(take: Take): Chapter[] {
  const scenes = take.chapters.filter(
    (c) => c.caption !== undefined && c.end - c.start > 0.05,
  );
  return scenes.length > 0
    ? scenes
    : [{ url: "", start: 0, end: take.duration }];
}

/** Zooms on bursts of taps, kept inside their own scene. */
function sceneZooms(
  take: Take,
  scene: Chapter,
  scale: number,
  index: number,
): ZoomSegment[] {
  if (scale <= 1) return [];
  const local = take.pointers
    .filter((p) => p.t >= scene.start && p.t <= scene.end)
    .map((p) => ({ ...p, t: p.t - scene.start }));
  return buildAutoZooms(local, scene.end - scene.start).map((z, k) => ({
    ...z,
    id: `scene-${index}-zoom-${k}`,
    start: z.start + scene.start,
    end: z.end + scene.start,
    scale,
  }));
}

/**
 * The montage of a scenario take: intro card, one clip and one caption per
 * scene, zooms on taps, touches drawn by the editor, outro card. Pure: the
 * same take and film always give the same edit, which stays fully editable.
 */
export function buildScenarioEdit(
  take: Take,
  film: Film,
  locale: string,
): EditState {
  const scenes = scenesOf(take);
  const clips: EditState["clips"] = [];
  const overlays: Overlay[] = [];
  const zooms: ZoomSegment[] = [];
  let at = 0;

  if (film.intro) {
    clips.push(card("intro", film, film.intro, locale));
    at += film.intro.duration;
  }
  scenes.forEach((scene, i) => {
    const clip: RecordingClip = {
      id: `scene-${i}`,
      kind: "recording",
      in: scene.start,
      out: scene.end,
      speed: 1,
      muted: true,
      cameraHidden: true,
      transition: i === 0 && film.intro ? CARD_FADE : null,
    };
    clips.push(clip);
    const length = scene.end - scene.start;
    if (scene.caption && film.captions !== "none")
      overlays.push({
        id: `caption-${i}`,
        kind: "text",
        lane: 0,
        start: at,
        duration: length,
        x: 0.5,
        y: film.captions === "top" ? 0.085 : 0.915,
        width: 0.88,
        height: 0.11,
        rotation: 0,
        opacity: 1,
        enter: "spring",
        exit: "fade",
        motion: 0.45,
        text: typeset(scene.caption, locale),
        style: {
          font: film.font,
          size: film.aspect === "16:9" ? 0.05 : 0.042,
          weight: 800,
          color: film.ink,
          align: "center",
          // Zooms slide the page under the caption: a plate keeps it legible.
          background: film.zoom > 1 ? film.background : null,
        },
      });
    zooms.push(...sceneZooms(take, scene, film.zoom, i));
    at += length;
  });
  if (film.outro) clips.push(card("outro", film, film.outro, locale));

  // Leave room for the caption above or below the device. In a wide frame
  // the device fills the height, so it is drawn smaller there.
  const captioned = film.captions !== "none";
  const wide = film.aspect !== "9:16";
  const y =
    film.captions === "top"
      ? wide
        ? 0.58
        : 0.56
      : film.captions === "bottom"
        ? wide
          ? 0.42
          : 0.44
        : 0.5;
  const scale = captioned && wide ? 0.8 : 1;
  return {
    ...DEFAULT_EDIT,
    aspect: film.aspect,
    background: { kind: "color", value: film.background },
    padding: film.captions === "none" ? 0.08 : 0.14,
    clips,
    overlays,
    zooms,
    touch: { style: "ring", color: film.accent, size: 44 },
    cursor: { ...DEFAULT_EDIT.cursor, visible: false },
    layers: take.layers.map((l) => ({
      instanceId: l.instanceId,
      deviceId: l.deviceId,
      colorId: l.colorId,
      frame: true,
      x: 0.5,
      y,
      scale,
      rotation: 0,
      hidden: false,
    })),
    camera: { ...DEFAULT_EDIT.camera, visible: false },
  };
}
