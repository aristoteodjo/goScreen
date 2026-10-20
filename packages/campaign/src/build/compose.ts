import {
  type Animation,
  DEFAULT_EDIT,
  DEFAULT_LOOK,
  type EditBackground,
  type EditState,
  type MainClip,
  type MeshStyle,
  meshPreset,
  PREMIUM_LOOK,
  type TextOverlay,
  type TransitionKind,
  type ZoomSegment,
} from "@goscreen/render-engine";

import type { Campaign, Format, Tone } from "../campaign";
import type { Proposal } from "../proposals";
import type { Recipe } from "../recipes";
import type { Role, Site } from "../site";
import { readableOn, shade, toHex } from "./color";
import { type Copy, type CopyProvider, localCopy } from "./copy";
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
    };

export interface BuildContext {
  site: Site;
  campaign: Campaign;
  /** Recording length in source seconds. */
  duration: number;
  /** Tour pages in source seconds (journal v4); empty for a single page. */
  chapters: Chapter[];
  copy?: CopyProvider;
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

const VERTICAL: Format[] = ["9:16", "4:5"];

/** Target length: the brief's hint kept inside the genre, else a third into its range. */
export function targetDuration(recipe: Recipe, campaign: Campaign): number {
  const [min, max] = recipe.duration;
  if (campaign.durationHint !== null)
    return Math.min(max, Math.max(min, campaign.durationHint));
  return Math.round(min + (max - min) / 3);
}

function palette(site: Site, campaign: Campaign) {
  const primary =
    toHex(campaign.brand.primary) ??
    toHex(site.brand.colors.primary) ??
    "#4f46e5";
  const ink = toHex(site.brand.colors.ink) ?? "#111111";
  const deep = shade(primary, -0.45);
  return {
    primary,
    // A lighter tone of the brand for accent words on dark plates.
    accent: shade(primary, 0.25),
    background: {
      kind: "gradient",
      from: primary,
      to: deep,
      angle: 150,
    } satisfies EditBackground,
    onBrand: readableOn(primary, ink),
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

/** Turns a proposal into a complete, editable montage of the recording. */
export function buildEdit(proposal: Proposal, ctx: BuildContext): EditState {
  const { recipe, format, variant } = proposal;
  const { site, campaign } = ctx;
  const copy: Copy = (ctx.copy ?? localCopy)(site, campaign);
  const look = LOOKS[campaign.tone];
  const colors = palette(site, campaign);
  const vertical = VERTICAL.includes(format);
  const scenes = scenesFrom(site.sections, ctx.chapters, ctx.duration);

  const target = targetDuration(recipe, campaign);
  const cardSeconds = recipe.structure.reduce(
    (s, b) => s + (b.kind === "card" ? b.seconds * look.pace : 0),
    0,
  );
  const weights = recipe.structure.reduce(
    (s, b) => s + (b.kind === "shots" ? b.weight : 0),
    0,
  );
  const footage = Math.max(0, target - cardSeconds);

  const clips: MainClip[] = [];
  const overlays: TextOverlay[] = [];
  const zooms: ZoomSegment[] = [];
  let t = 0;
  let n = 0;
  const transition = () =>
    clips.length === 0
      ? null
      : { kind: look.transition, duration: look.transitionSeconds };

  const cardText = (text: Extract<Beat, { kind: "card" }>["text"]) =>
    ({
      hook: [copy.hook, ""],
      name: [copy.name, ""],
      walkthrough: [copy.walkthrough, copy.name],
      cta: [copy.cta, copy.url],
    })[text];

  for (const beat of recipe.structure) {
    if (beat.kind === "card") {
      const [title, subtitle] = cardText(beat.text);
      const duration = beat.seconds * look.pace;
      clips.push({
        id: `${recipe.id}-${n++}`,
        kind: "slide",
        duration,
        background: colors.background,
        title,
        subtitle,
        color: colors.onBrand,
        font: colors.heading,
        animation: beat.text === "cta" ? "pop" : look.text,
        transition: transition(),
      });
      t += duration;
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
          scale: vertical ? 1.5 : 1.35,
          focus: { x: 0.5, y: 0.4 },
        });
      }
      // The hero says what the hook card just said: no caption on it.
      if (beat.captions && scene.role !== "hero" && length > 1.2) {
        const label = copy.caption(scene, i);
        overlays.push({
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
        });
      }
      t += length;
    });
  }

  return {
    ...DEFAULT_EDIT,
    aspect: format,
    background: look.backdrop
      ? meshPreset(look.backdrop, colors.primary, "dark")
      : colors.background,
    padding: vertical ? 0.06 : 0.08,
    clips,
    overlays,
    zooms,
    // The shell lays the recorded devices out (`initialLayers`) once it knows the source size.
    layers: null,
    camera: { ...DEFAULT_EDIT.camera, visible: false },
    touch: look.premium
      ? { style: "ripple", color: colors.accent, size: 44, spotlight: 0.5 }
      : { ...DEFAULT_EDIT.touch, style: "none" },
    screen: look.premium ? PREMIUM_LOOK : DEFAULT_LOOK,
  };
}
