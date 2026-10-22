import {
  buildAutoZooms,
  type Chapter,
  clipDuration,
  DEFAULT_DRIFT,
  DEFAULT_EDIT,
  DEFAULT_LOOK,
  type EditBackground,
  type EditState,
  hexToHsl,
  meshPreset,
  PREMIUM_LOOK,
  type Overlay,
  type TextOverlay,
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
  const showcase = film.look === "showcase";
  const base: SlideClip = {
    id,
    kind: "slide",
    transition: CARD_FADE,
    duration: c.duration,
    background: {
      kind: "color",
      value: film.background,
      ...(showcase ? { decor: [cardDisc(film)] } : {}),
    },
    title: typeset(showcase ? c.title : c.title.replaceAll("*", ""), locale),
    subtitle: typeset(c.subtitle, locale),
    color: film.ink,
    font: film.font,
    animation: "words",
  };
  if (!showcase) return base;
  return {
    ...base,
    layout: "left",
    accent: film.accent,
    muted: mix(film.ink, film.background, 0.62),
    ...(film.brand ? { brand: film.brand } : {}),
    ...(c.eyebrow ? { eyebrow: typeset(c.eyebrow, locale) } : {}),
  };
}

/** a..b at t (0 = a): the muted ink of kickers and subtitles. */
export function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) =>
    [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((v, i) => Math.round(v + (y[i] - v) * (1 - t)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// The accent discs, as in the VSL: one behind the device, one in the
// corner of the cards.
const sceneDisc = (film: Film) => {
  const wide = film.aspect === "16:9";
  return {
    x: wide ? 0.86 : 0.944,
    y: wide ? 0.3 : 0.36,
    r: wide ? 0.2 : 0.306,
    color: film.accent,
    opacity: 0.16,
  };
};
const cardDisc = (film: Film) => ({
  x: 0.833,
  y: film.aspect === "16:9" ? 0.85 : 0.896,
  r: film.aspect === "16:9" ? 0.19 : 0.333,
  color: film.accent,
  opacity: 0.16,
});

function sceneBackground(film: Film): EditBackground {
  const decor = film.look === "showcase" ? { decor: [sceneDisc(film)] } : {};
  if (film.backdrop !== "flat") {
    const mode = hexToHsl(film.background)[2] > 0.5 ? "light" : "dark";
    return { ...meshPreset(film.backdrop, film.accent, mode), ...decor };
  }
  return { kind: "color", value: film.background, ...decor };
}

/**
 * The screen look, device frame and camera drift a film asks for: the
 * premium look never lets the camera stand still.
 */
function screenOf(film: Film) {
  return film.screen === "premium"
    ? {
        screen: PREMIUM_LOOK,
        frame: false,
        touch: "ripple" as const,
        drift: DEFAULT_DRIFT,
      }
    : {
        screen: DEFAULT_LOOK,
        frame: true,
        touch: "ring" as const,
        drift: undefined,
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
      overlays.push(
        captionOverlay(
          {
            id: `caption-${i}`,
            kind: "text",
            lane: 0,
            start: at,
            duration: length,
            x: 0.5,
            y: 0,
            width: 0.88,
            height: 0.11,
            rotation: 0,
            opacity: 1,
            enter: "spring",
            exit: "fade",
            motion: 0.45,
            text: typeset(starNumbers(scene.caption), locale),
            style: captionStyle(film),
          },
          film,
        ),
      );
    zooms.push(...sceneZooms(take, scene, film.zoom, i));
    at += length;
  });
  if (film.outro) clips.push(card("outro", film, film.outro, locale));

  const { x, y, scale } = deviceLayout(film);
  const look = screenOf(film);
  return {
    ...DEFAULT_EDIT,
    aspect: film.aspect,
    background: sceneBackground(film),
    padding: framePadding(film),
    clips,
    overlays: [...overlays, ...kickers(overlays, film)],
    zooms,
    touch: {
      style: look.touch,
      color: film.accent,
      size: 44,
      spotlight: film.screen === "premium" ? 0.5 : 0,
    },
    cursor: { ...DEFAULT_EDIT.cursor, visible: false },
    layers: take.layers.map((l) => ({
      instanceId: l.instanceId,
      deviceId: l.deviceId,
      colorId: l.colorId,
      frame: look.frame,
      x,
      y,
      scale,
      rotation: 0,
      hidden: false,
    })),
    camera: { ...DEFAULT_EDIT.camera, visible: false },
    screen: look.screen,
    drift: look.drift,
    film: { settings: film, locale },
  };
}

/**
 * Where scene texts go. Showcase: kicker then title flush left above the
 * device (beside it in 16:9); plain: one centered line above or below.
 * Sizes are line heights as a fraction of the output height.
 */
function textLayout(film: Film) {
  if (film.look === "plain")
    return {
      kicker: null,
      title: {
        x: 0.5,
        y: film.captions === "bottom" ? 0.915 : 0.085,
        width: 0.88,
        height: 0.11,
        size: film.aspect === "16:9" ? 0.05 : 0.042,
        align: "center" as const,
      },
    };
  // 9:16 follows the VSL's 1080x1920 grid: 72 px margins, a 76 px title.
  const grid = {
    "9:16": { kickerY: 0.08, titleY: 0.14, title: 0.0495, kicker: 0.0195 },
    "4:5": { kickerY: 0.075, titleY: 0.155, title: 0.059, kicker: 0.024 },
    "1:1": { kickerY: 0.075, titleY: 0.165, title: 0.066, kicker: 0.027 },
    "16:9": { kickerY: 0.38, titleY: 0.5, title: 0.088, kicker: 0.033 },
  }[film.aspect];
  // Texts under the device: a lower third, whatever the format.
  if (film.captions === "bottom") {
    const k = grid.kicker;
    const t = film.aspect === "16:9" ? 0.06 : grid.title;
    return {
      kicker: {
        x: 0.5,
        width: 0.867,
        y: 0.905 - t * 1.4,
        height: k * 1.6,
        size: k,
        align: "left" as const,
      },
      title: {
        x: 0.5,
        width: 0.867,
        y: 0.925,
        height: t * 1.2,
        size: t,
        align: "left" as const,
      },
    };
  }
  const wide = film.aspect === "16:9";
  const column = wide ? { x: 0.3, width: 0.44 } : { x: 0.5, width: 0.867 };
  return {
    kicker: {
      ...column,
      y: grid.kickerY,
      height: grid.kicker * 1.6,
      size: grid.kicker,
      align: "left" as const,
    },
    title: {
      ...column,
      y: grid.titleY,
      height: wide ? 0.3 : 0.1,
      size: grid.title,
      align: "left" as const,
    },
  };
}

function captionStyle(film: Film): TextOverlay["style"] {
  const t = textLayout(film).title;
  const plain = film.look === "plain";
  return {
    font: film.font,
    size: t.size,
    weight: 800,
    color: film.ink,
    align: t.align,
    // Plain captions sit on the page, which zooms slide under: a plate
    // keeps them legible. Showcase texts are off the device.
    background: plain && film.zoom > 1 ? film.background : null,
    // The course's text: one accent word per phrase (flash, sweep), a glow
    // that peaks after the entrance, a hard shadow when over the picture.
    accent: film.accent,
    flash: true,
    sweep: true,
    glow: 0.12,
    shadow: plain ? 0.6 : 0,
  };
}

/**
 * Marks the figures of a caption as accent words ("*2 493* plateaux"):
 * numbers are the proof a SaaS ad insists on. Words already starred stay.
 */
export function starNumbers(text: string): string {
  if (text.includes("*")) return text;
  // A number with its spaces, separators, unit sign or currency.
  return text.replace(
    /(?<![\w*])[+-]?\d[\d\u00a0\u202f ,.]*\d?\s?(?:%|€|\$|£|k|M|x|×)?(?![\w*])/g,
    (m) => {
      const core = m.replace(/\s+$/, "");
      const tail = m.slice(core.length);
      return core.trim() ? `*${core}*${tail}` : m;
    },
  );
}

/** A scene title placed and styled by the film; its words and timing kept. */
function captionOverlay(o: TextOverlay, film: Film): TextOverlay {
  const t = textLayout(film).title;
  return {
    ...o,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    opacity: film.captions === "none" ? 0 : 1,
    style: { ...o.style, ...captionStyle(film) },
  };
}

/** "BUYER · 2/11" above each scene title, as many as there are titles. */
function kickers(overlays: Overlay[], film: Film): TextOverlay[] {
  const k = textLayout(film).kicker;
  if (!k || !film.label.trim() || film.captions === "none") return [];
  const titles = overlays
    .filter(
      (o): o is TextOverlay => o.kind === "text" && o.id.startsWith("caption-"),
    )
    .sort((a, b) => a.start - b.start);
  return titles.map((t, i) => ({
    id: `kicker-${t.id.slice("caption-".length)}`,
    kind: "text",
    lane: 1,
    start: t.start,
    duration: t.duration,
    x: k.x,
    y: k.y,
    width: k.width,
    height: k.height,
    rotation: 0,
    opacity: 1,
    enter: "fade",
    exit: "fade",
    motion: 0.3,
    text: `${film.label.toUpperCase()} · ${i + 1}/${titles.length}`,
    style: {
      font: '"JetBrains Mono"',
      size: k.size,
      weight: 500,
      color: mix(film.ink, film.background, 0.62),
      align: "left",
      background: null,
      bullet: film.accent,
      tracking: 0.08,
    },
  }));
}

const framePadding = (film: Film) => (film.captions === "none" ? 0.08 : 0.14);

/**
 * Where the device sits. Showcase: the VSL's frame, 75 % of a 9:16 film's
 * height under the texts, on the right in 16:9. Plain: room for a caption
 * above or below, smaller in wide frames.
 */
function deviceLayout(film: Film) {
  // A frameless glass is scaled on its own height (no bezel), and leans
  // towards the texts: a little smaller keeps the same footprint.
  const k =
    film.screen !== "premium" ? 1 : film.aspect === "9:16" ? 0.96 : 0.86;
  const scaled = (p: { x: number; y: number; scale: number }) => ({
    ...p,
    scale: p.scale * k,
  });
  if (film.look === "showcase") {
    if (film.captions === "none") return scaled({ x: 0.5, y: 0.5, scale: 0.86 });
    if (film.captions === "bottom")
      return scaled({
        x: 0.5,
        y: 0.42,
        scale: film.aspect === "9:16" ? 0.72 : 0.68,
      });
    return scaled(
      {
        "9:16": { x: 0.5, y: 0.589, scale: 0.75 },
        "4:5": { x: 0.5, y: 0.62, scale: 0.66 },
        "1:1": { x: 0.5, y: 0.63, scale: 0.62 },
        "16:9": { x: 0.72, y: 0.52, scale: 0.86 },
      }[film.aspect],
    );
  }
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
  return scaled({
    x: 0.5,
    y,
    scale: film.captions !== "none" && wide ? 0.8 : 1,
  });
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
  const { x, y, scale } = deviceLayout(film);
  const look = screenOf(film);
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
  // Kickers follow the titles: rebuilt each time, never edited apart.
  const overlays = edit.overlays
    .filter((o) => !o.id.startsWith("kicker-"))
    .map((o) =>
      o.kind === "text" && o.id.startsWith("caption-")
        ? captionOverlay(o, film)
        : o,
    );
  return {
    ...edit,
    aspect: film.aspect,
    background: sceneBackground(film),
    padding: framePadding(film),
    clips: [...(intro ? [intro] : []), ...scenes, ...(outro ? [outro] : [])],
    overlays: [...overlays, ...kickers(overlays, film)],
    zooms: edit.zooms.map((z) =>
      z.id.startsWith("scene-") ? { ...z, scale: Math.max(1, film.zoom) } : z,
    ),
    touch: {
      ...edit.touch,
      color: film.accent,
      style: look.touch,
      spotlight: film.screen === "premium" ? 0.5 : 0,
    },
    layers:
      edit.layers?.map((l) => ({ ...l, x, y, scale, frame: look.frame })) ??
      null,
    screen: look.screen,
    // A drift set by hand stays; the premium look switches it on.
    drift: edit.drift ?? look.drift,
    film: { settings: film, locale },
  };
}

/**
 * Makes any montage a film: its first and last cards become the opening
 * and closing cards, and the text starting with each recorded clip becomes
 * that scene's title. Then the film's settings apply as usual.
 */
export function adoptFilm(
  edit: EditState,
  film: Film,
  locale: string,
): EditState {
  const clips = [...edit.clips];
  const asCard = (c: (typeof clips)[number] | undefined) =>
    c?.kind === "slide"
      ? {
          title: c.title || " ",
          subtitle: c.subtitle,
          duration: c.duration,
        }
      : undefined;
  const intro = film.intro ?? asCard(clips[0]);
  const outro =
    film.outro ?? (clips.length > 1 ? asCard(clips.at(-1)) : undefined);
  if (clips[0]?.kind === "slide") clips[0] = { ...clips[0], id: "intro" };
  const last = clips.length - 1;
  if (last > 0 && clips[last].kind === "slide")
    clips[last] = { ...clips[last], id: "outro" };
  let at = 0;
  const starts: number[] = [];
  for (const c of clips) {
    if (c.kind === "recording") starts.push(at);
    at += clipDuration(c);
  }
  let n = 0;
  const overlays = edit.overlays.map((o) => {
    if (o.kind !== "text" || o.id.startsWith("caption-")) return o;
    const k = starts.findIndex((s) => Math.abs(s - o.start) < 0.05);
    return k < 0 ? o : { ...o, id: `caption-${k}-${n++}` };
  });
  return applyFilm(
    { ...edit, clips, overlays },
    { ...film, intro, outro },
    locale,
  );
}
