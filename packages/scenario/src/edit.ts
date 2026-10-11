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
    // Hidden captions are kept (transparent) so the film can show them again.
    if (scene.caption)
      overlays.push({
        id: `caption-${i}`,
        kind: "text",
        lane: 0,
        start: at,
        duration: length,
        x: 0.5,
        y: captionY(film),
        width: 0.88,
        height: 0.11,
        rotation: 0,
        opacity: film.captions === "none" ? 0 : 1,
        enter: "spring",
        exit: "fade",
        motion: 0.45,
        text: typeset(scene.caption, locale),
        style: captionStyle(film),
      });
    zooms.push(...sceneZooms(take, scene, film.zoom, i));
    at += length;
  });
  if (film.outro) clips.push(card("outro", film, film.outro, locale));

  const { y, scale } = deviceLayout(film);
  return {
    ...DEFAULT_EDIT,
    aspect: film.aspect,
    background: { kind: "color", value: film.background },
    padding: framePadding(film),
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
    film: { settings: film, locale },
  };
}

const captionY = (film: Film) => (film.captions === "bottom" ? 0.915 : 0.085);

function captionStyle(film: Film) {
  return {
    font: film.font,
    size: film.aspect === "16:9" ? 0.05 : 0.042,
    weight: 800,
    color: film.ink,
    align: "center" as const,
    // Zooms slide the page under the caption: a plate keeps it legible.
    background: film.zoom > 1 ? film.background : null,
  };
}

const framePadding = (film: Film) => (film.captions === "none" ? 0.08 : 0.14);

/**
 * Where the device sits: room for the caption above or below it, and drawn
 * smaller in wide frames, where it would otherwise fill the height.
 */
function deviceLayout(film: Film) {
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
  return { y, scale: film.captions !== "none" && wide ? 0.8 : 1 };
}

/**
 * Applies film settings to a built montage, Remotion-style "props": format,
 * colours, font, captions, zoom and cards change; anything else the person
 * edited (trims, extra texts, blocks, animations) stays as it is.
 */
export function applyFilm(
  edit: EditState,
  film: Film,
  locale: string,
): EditState {
  const { y, scale } = deviceLayout(film);
  const cardFor = (id: "intro" | "outro") => {
    const c = film[id];
    return c ? card(id, film, c, locale) : null;
  };
  const middle = edit.clips.filter((c) => c.id !== "intro" && c.id !== "outro");
  const intro = cardFor("intro");
  const outro = cardFor("outro");
  // The first scene fades in after an opening card, cuts in without one.
  const first = middle[0];
  const scenes = first
    ? [
        {
          ...first,
          transition: intro ? (first.transition ?? CARD_FADE) : null,
        },
        ...middle.slice(1),
      ]
    : [];
  return {
    ...edit,
    aspect: film.aspect,
    background: { kind: "color", value: film.background },
    padding: framePadding(film),
    clips: [...(intro ? [intro] : []), ...scenes, ...(outro ? [outro] : [])],
    overlays: edit.overlays.map((o) =>
      o.kind === "text" && o.id.startsWith("caption-")
        ? {
            ...o,
            y: captionY(film),
            opacity: film.captions === "none" ? 0 : 1,
            style: { ...o.style, ...captionStyle(film) },
          }
        : o,
    ),
    zooms: edit.zooms.map((z) =>
      z.id.startsWith("scene-") ? { ...z, scale: Math.max(1, film.zoom) } : z,
    ),
    touch: { ...edit.touch, color: film.accent },
    layers: edit.layers?.map((l) => ({ ...l, y, scale })) ?? null,
    film: { settings: film, locale },
  };
}
