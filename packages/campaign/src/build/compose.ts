import {
  type Animation,
  type Asset,
  DEFAULT_EDIT,
  DEFAULT_LOOK,
  type EditBackground,
  type EditState,
  type MainClip,
  type MeshStyle,
  meshPreset,
  type Overlay,
  PREMIUM_LOOK,
  type TextOverlay,
  type TransitionKind,
  type VideoOverlay,
  type ZoomSegment,
} from "@goscreen/render-engine";

import type { Campaign, Format, Tone } from "../campaign";
import type { Proposal } from "../proposals";
import type { Recipe } from "../recipes";
import type { Role, Site } from "../site";
import { readableOn, shade, toHex } from "./color";
import { type Copy, type CopyProvider, localCopy } from "./copy";
import { type SceneFill, sceneOf } from "./scene";
import { type Chapter, pickScenes, type Scene, scenesFrom } from "./scenes";

/** One step of a genre's structure. Seconds are at the recipe's default length. */
export type Beat =
  | {
      kind: "card";
      text: "hook" | "name" | "cta" | "walkthrough";
      seconds: number;
    }
  | {
      kind: "shots";
      roles: Role[];
      count: number;
      /** Share of the footage time this beat gets, relative to other shot beats. */
      weight: number;
      speed?: number;
      captions?: boolean;
      numbered?: boolean;
      /** Keep the source order (a walkthrough) instead of the role order. */
      chronological?: boolean;
    }
  | {
      /**
       * A scene composition of the dynamic look, full frame, filled from the
       * site and the brief (`fill`). Emitted as a video layer that is not
       * rendered yet (see `sceneLayer`).
       */
      kind: "scene";
      composition: string;
      fill: SceneFill;
      seconds: number;
    };

/**
 * What the app offers beyond this package's vocabulary, so a montage never
 * names a transition, a backdrop or a composition the app cannot draw. The
 * shell reads it from `control.catalog` / `help.formats`; a test passes it
 * by hand. Absent: the safe fallbacks (`push`, `circles`, no `film.sound`).
 */
export interface Available {
  transitions?: string[];
  backdrops?: string[];
  compositions?: string[];
  /** `film.sound` is understood by the film schema. */
  sound?: boolean;
}

export interface BuildContext {
  site: Site;
  campaign: Campaign;
  /** Recording length in source seconds. */
  duration: number;
  /** Tour pages in source seconds (journal v4); empty for a single page. */
  chapters: Chapter[];
  copy?: CopyProvider;
  available?: Available;
}

interface Look {
  transition: TransitionKind;
  transitionSeconds: number;
  text: Animation;
  /** Multiplies card lengths: calm tones breathe, energetic ones cut fast. */
  pace: number;
  /** The SaaS-ad screen: frameless glass leaning in perspective (else the device frame). */
  premium: boolean;
  /** Moving cinematic backdrop built from the brand colour, or the flat gradient. */
  backdrop: MeshStyle | null;
}

const LOOKS: Record<Tone, Look> = {
  energetic: {
    transition: "push",
    transitionSeconds: 0.35,
    text: "words",
    pace: 0.85,
    premium: true,
    backdrop: "circles",
  },
  playful: {
    transition: "zoom",
    transitionSeconds: 0.4,
    text: "pop",
    pace: 0.9,
    premium: true,
    backdrop: "blob",
  },
  calm: {
    transition: "blur",
    transitionSeconds: 0.6,
    text: "fade",
    pace: 1.15,
    premium: true,
    backdrop: "waves",
  },
  premium: {
    transition: "blur",
    transitionSeconds: 0.7,
    text: "fade",
    pace: 1.2,
    premium: true,
    backdrop: "circles",
  },
  corporate: {
    transition: "dip",
    transitionSeconds: 0.5,
    text: "slide-up",
    pace: 1,
    premium: false,
    backdrop: null,
  },
};

/**
 * The dynamic look (references Zelios / AfterRender, `dynamic-analysis.md`):
 * the camera goes through each element (`zoomThrough`) instead of cutting,
 * the brand hue is a beam of light on a near-black field, every scene is a
 * 3D composition. Only the pace of the tone is kept.
 */
export const DYNAMIC_TRANSITION = "zoomThrough";
export const DYNAMIC_BACKDROP = "beam";
export const DYNAMIC_FIELD = "#070a10";

const DYNAMIC: Look = {
  transition: "push",
  transitionSeconds: 0.5,
  text: "words",
  pace: 1,
  premium: true,
  backdrop: "circles",
};

const VERTICAL: Format[] = ["9:16", "4:5"];

/** Target length: the brief's hint kept inside the genre, else a third into its range. */
export function targetDuration(recipe: Recipe, campaign: Campaign): number {
  const [min, max] = recipe.duration;
  if (campaign.durationHint !== null)
    return Math.min(max, Math.max(min, campaign.durationHint));
  return Math.round(min + (max - min) / 3);
}

function palette(site: Site, campaign: Campaign, dynamic: boolean) {
  const primary =
    toHex(campaign.brand.primary) ??
    toHex(site.brand.colors.primary) ??
    "#4f46e5";
  const ink = dynamic ? "#f4f6fa" : (toHex(site.brand.colors.ink) ?? "#111111");
  const deep = shade(primary, -0.45);
  return {
    primary,
    // A lighter tone of the brand for accent words on dark plates.
    accent: shade(primary, 0.25),
    background: dynamic
      ? ({ kind: "color", value: DYNAMIC_FIELD } satisfies EditBackground)
      : ({
          kind: "gradient",
          from: primary,
          to: deep,
          angle: 150,
        } satisfies EditBackground),
    onBrand: dynamic ? ink : readableOn(primary, ink),
    pill: ink,
    onPill: readableOn(ink),
    heading:
      campaign.brand.font ??
      site.brand.fonts.heading ??
      site.brand.fonts.body ??
      "Inter",
    body: site.brand.fonts.body ?? site.brand.fonts.heading ?? "Inter",
  };
}

/** The asset id of a scene layer that is not rendered yet. */
export const pendingAsset = (overlayId: string) => `composition:${overlayId}`;
/** Pending files end with this: the app renders them when the montage opens. */
export const PENDING_EXT = ".pending";

/**
 * The placeholder asset of a scene layer that is not rendered yet. A parse
 * drops a media layer whose asset is missing, so the entry exists, with a
 * file name that no renderer wrote: `<overlay id>.pending`. The app renders
 * every video layer whose asset file ends with `.pending` (same composition,
 * props, box and duration as `edit.addComposition`) and replaces the file.
 */
export function pendingSceneAsset(
  overlayId: string,
  composition: string,
  duration: number,
): Asset {
  return {
    id: pendingAsset(overlayId),
    name: composition,
    kind: "video",
    file: `${overlayId}${PENDING_EXT}`,
    duration,
  };
}

/**
 * A scene composition laid out but not rendered: a full-frame video layer
 * whose `source.composition` names the scene and whose `asset` is the
 * pending asset above. The app renders it when the montage opens (or
 * `edit.addComposition` with the same id, props, start and box does).
 */
export function sceneLayer(
  id: string,
  composition: string,
  props: Record<string, string | number>,
  start: number,
  duration: number,
): VideoOverlay {
  return {
    id,
    kind: "video",
    lane: 1,
    start,
    duration,
    x: 0.5,
    y: 0.5,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
    enter: "none",
    exit: "none",
    motion: 0.4,
    asset: pendingAsset(id),
    in: 0,
    volume: 0,
    radius: 0,
    source: { composition, props },
  };
}

const has = (list: string[] | undefined, item: string) =>
  list === undefined ? false : list.includes(item);

/** Turns a proposal into a complete, editable montage of the recording. */
export function buildEdit(proposal: Proposal, ctx: BuildContext): EditState {
  const { recipe, format, variant } = proposal;
  const { site, campaign } = ctx;
  const dynamic = recipe.dynamic === true;
  const copy: Copy = (ctx.copy ?? localCopy)(site, campaign);
  const look = dynamic
    ? { ...DYNAMIC, pace: LOOKS[campaign.tone].pace }
    : LOOKS[campaign.tone];
  const colors = palette(site, campaign, dynamic);
  const vertical = VERTICAL.includes(format);
  const scenes = scenesFrom(site.sections, ctx.chapters, ctx.duration);
  const available = ctx.available ?? {};
  // Names the app may not know are written only when it says it draws them.
  const transitionKind = (
    dynamic && has(available.transitions, DYNAMIC_TRANSITION)
      ? DYNAMIC_TRANSITION
      : look.transition
  ) as TransitionKind;
  const backdropStyle = (
    dynamic && has(available.backdrops, DYNAMIC_BACKDROP)
      ? DYNAMIC_BACKDROP
      : look.backdrop
  ) as MeshStyle | null;
  const backdrop: EditBackground = backdropStyle
    ? {
        ...meshPreset(look.backdrop ?? "circles", colors.primary, "dark"),
        style: backdropStyle,
        ...(dynamic ? { base: DYNAMIC_FIELD } : {}),
      }
    : colors.background;

  const target = targetDuration(recipe, campaign);
  const cardSeconds = recipe.structure.reduce(
    (s, b) => s + (b.kind === "shots" ? 0 : b.seconds * look.pace),
    0,
  );
  const weights = recipe.structure.reduce(
    (s, b) => s + (b.kind === "shots" ? b.weight : 0),
    0,
  );
  const footage = Math.max(0, target - cardSeconds);

  const clips: MainClip[] = [];
  const overlays: Overlay[] = [];
  const assets: Asset[] = [];
  const zooms: ZoomSegment[] = [];
  let t = 0;
  let n = 0;
  const transition = () =>
    clips.length === 0
      ? null
      : { kind: transitionKind, duration: look.transitionSeconds };

  const cardText = (text: Extract<Beat, { kind: "card" }>["text"]) =>
    ({
      hook: [copy.hook, ""],
      name: [copy.name, ""],
      walkthrough: [copy.walkthrough, copy.name],
      cta: [copy.cta, copy.url],
    })[text];

  const card = (
    title: string,
    subtitle: string,
    duration: number,
    animation: Animation,
  ) => {
    clips.push({
      id: `${recipe.id}-${n++}`,
      kind: "slide",
      duration,
      background: dynamic ? backdrop : colors.background,
      title,
      subtitle,
      color: colors.onBrand,
      font: colors.heading,
      animation,
      transition: transition(),
    });
    t += duration;
  };

  const hero = scenes.find((s) => s.role === "hero") ?? null;

  for (const beat of recipe.structure) {
    if (beat.kind === "card") {
      const [title, subtitle] = cardText(beat.text);
      card(
        title,
        subtitle,
        beat.seconds * look.pace,
        beat.text === "cta" ? "pop" : look.text,
      );
      continue;
    }

    if (beat.kind === "scene") {
      const scene = sceneOf(beat.fill, beat.composition, {
        copy,
        sections: site.sections,
        hero,
      });
      // A site that states no figure skips the figure beat: never an empty scene.
      if (!scene) continue;
      const duration = beat.seconds * look.pace;
      if (
        available.compositions !== undefined &&
        !has(available.compositions, scene.composition)
      ) {
        // The app does not have this scene: its words go on a card instead.
        card(scene.text, "", duration, look.text);
        continue;
      }
      const id = `${recipe.id}-scene-${n}`;
      // The scene sits on a card of the backdrop so the main track runs under it.
      card("", "", duration, "none");
      overlays.push(
        sceneLayer(id, scene.composition, scene.props, t - duration, duration),
      );
      assets.push(pendingSceneAsset(id, scene.composition, duration));
      continue;
    }

    let picked = pickScenes(scenes, beat.roles, beat.count, variant);
    if (beat.chronological)
      picked = [...picked].sort((a, b) => a.start - b.start);
    if (picked.length === 0) continue;
    const speed = beat.speed ?? 1;
    let step = 0;
    // Timeline seconds per shot, then source seconds at this speed.
    const each =
      (footage * (beat.weight / Math.max(weights, 1e-6))) / picked.length;
    picked.forEach((scene: Scene, i) => {
      // Near the end of the recording, start earlier rather than cut the shot short.
      const start = Math.max(
        0,
        Math.min(scene.start, ctx.duration - each * speed),
      );
      const out = Math.min(ctx.duration, start + each * speed);
      if (out - start < 0.5) return;
      const length = (out - start) / speed;
      clips.push({
        id: `${recipe.id}-${n++}`,
        kind: "recording",
        in: start,
        out,
        speed,
        muted: true,
        cameraHidden: true,
        transition: transition(),
      });
      if (out - start > 2) {
        zooms.push({
          id: `${recipe.id}-zoom-${zooms.length}`,
          start: start + 0.6 * speed,
          end: out - 0.4 * speed,
          // The dynamic look keeps the camera inside the rules' ceiling: the
          // movement comes from the scenes, not from a tight zoom.
          scale: dynamic ? 1.12 : vertical ? 1.5 : 1.35,
          focus: { x: 0.5, y: 0.4 },
        });
      }
      // The hero says what the hook card just said: no caption on it.
      if (beat.captions && scene.role !== "hero" && length > 1.2) {
        const label = copy.caption(scene, i);
        const caption: TextOverlay = {
          id: `${recipe.id}-caption-${overlays.length}`,
          kind: "text",
          lane: 0,
          start: t + 0.3,
          duration: length - 0.6,
          x: 0.5,
          y: vertical ? 0.13 : 0.88,
          width: 0.86,
          height: vertical ? 0.08 : 0.1,
          rotation: 0,
          opacity: 1,
          enter: look.text,
          exit: "fade",
          motion: 0.35,
          text: beat.numbered ? `${++step} · ${label}` : label,
          style: {
            font: colors.body,
            size: vertical ? 0.034 : 0.045,
            weight: 700,
            color: colors.onPill,
            align: "center",
            background: colors.pill,
            // One accent word per caption, flashed and swept as it comes in.
            accent: colors.accent,
            flash: true,
            sweep: true,
            glow: 0.1,
          },
        };
        overlays.push(caption);
      }
      t += length;
    });
  }

  const film = dynamic
    ? {
        settings: {
          aspect: format,
          background: DYNAMIC_FIELD,
          ink: colors.onBrand,
          accent: colors.accent,
          font: colors.heading,
          captions: "none",
          zoom: 1.12,
          look: "plain",
          backdrop: backdropStyle ?? "flat",
          screen: "premium",
          label: "",
          brand: copy.name,
          // One sound per movement: only when the film schema knows the field.
          ...(available.sound ? { sound: "full" } : {}),
        },
        locale: campaign.language,
      }
    : undefined;

  return {
    ...DEFAULT_EDIT,
    aspect: format,
    background: backdrop,
    padding: vertical ? 0.06 : 0.08,
    clips,
    overlays,
    assets,
    zooms,
    // The shell lays the recorded devices out (`initialLayers`) once it knows the source size.
    layers: null,
    camera: { ...DEFAULT_EDIT.camera, visible: false },
    touch: look.premium
      ? { style: "ripple", color: colors.accent, size: 44, spotlight: 0.5 }
      : { ...DEFAULT_EDIT.touch, style: "none" },
    screen: look.premium ? PREMIUM_LOOK : DEFAULT_LOOK,
    ...(film ? { film } : {}),
  };
}
