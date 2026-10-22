import type { Section } from "../site";
import type { Copy } from "./copy";
import { shorten } from "./copy";
import type { Scene } from "./scenes";

/**
 * What a scene composition is filled with. A recipe names the fill, never the
 * words: the words come from the site and the brief at build time.
 */
export type SceneFill = "hook" | "product" | "benefits" | "figure" | "brand";

/** Props of a scene layer, as `VideoOverlay.source.props` carries them. */
export type SceneProps = Record<string, string | number>;

/**
 * Scene compositions of the dynamic look (embedded in the app, placed with
 * `edit.addComposition`), with the prop names each one reads.
 */
export const SCENE_COMPOSITIONS = [
  "glow-stage",
  "device-3d",
  "floating-cards",
  "cards-stack-3d",
  "icon-grid-3d",
  "carousel-3d",
  "kinetic-counter",
  "text-inline-icon",
  "brand-blur",
  "orbit-updates",
  "chat-typing",
  "search-focus",
  "cursor-click",
] as const;
export type SceneComposition = (typeof SCENE_COMPOSITIONS)[number];

/** Scenes that show the product as an object in space (3D). */
export const SCENES_3D: ReadonlySet<string> = new Set([
  "device-3d",
  "floating-cards",
  "cards-stack-3d",
  "icon-grid-3d",
  "carousel-3d",
  "orbit-updates",
]);

/** The take's frame at a source time, for `device-3d` (`screen`, `screenAt`). */
export const RECORDING_SCREEN = "recording";

/** Roles whose titles read as benefits, best first. */
const BENEFIT_ROLES = [
  "features",
  "how-it-works",
  "listing",
  "pricing",
  "stats",
  "testimonials",
] as const;

/** A figure read from a section: "12 000 teams" -> { value: 12000, suffix: "", label: "teams" }. */
export interface Figure {
  value: number;
  suffix: string;
  label: string;
}

const FIGURE =
  /(\d{1,3}(?:[   .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(%|[kKM]\b|\+)?\s*([^\d.,;!?\n]{0,60})/u;

/**
 * The first figure of a text, with the words that follow it as its label
 * (at most four). Thousands separators are read; "9,5" and "9.5" both mean
 * nine and a half. Null when the text has no number.
 */
export function figureOf(text: string): Figure | null {
  // A window of time ("ces 30 derniers jours", "in the last 7 days") counts
  // nothing: the next figure of the text is read instead. A duration that is
  // the claim itself ("set up in 9 minutes") stays.
  const all = new RegExp(FIGURE.source, "gu");
  for (const m of text.matchAll(all)) {
    const f = figureFrom(m);
    if (!f) continue;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
    const unit = TIME_UNIT.test(f.label);
    const window =
      unit && (WINDOW_AFTER.test(f.label) || WINDOW_BEFORE.test(before));
    if (!window) return f;
  }
  return null;
}

const UNITS =
  "(secondes?|minutes?|heures?|jours?|semaines?|mois|ans?|années?|seconds?|hours?|days?|weeks?|months?|years?)";
const TIME_UNIT = new RegExp(`^(\\p{L}+\\s+)?${UNITS}\\b`, "iu");
// "30 derniers jours", "3 prochains mois".
const WINDOW_AFTER = /^(derni(?:er|ère)s?|prochain(?:e|s|es)?)\s/iu;
// "the last 7 days", "ces 30 …", "past 12 months".
const WINDOW_BEFORE = /(last|past|next|ces|les|over the)\s*$/iu;

function figureFrom(m: RegExpMatchArray): Figure | null {
  const raw = m[1];
  const grouped = /[   .,]\d{3}/.test(raw) && !/^\d+[.,]\d{1,2}$/.test(raw);
  const value = grouped
    ? Number(raw.replace(/[   .,]/g, ""))
    : Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = m[2] ?? "";
  const label = shorten((m[3] ?? "").trim(), 4).replace(/…$/, "");
  return { value, suffix, label };
}

/** The first figure the site states, in the sections that usually carry one. */
export function siteFigure(sections: Section[]): Figure | null {
  const order = ["stats", "testimonials", "pricing", "hero", "features"];
  for (const role of order)
    for (const s of sections.filter((x) => x.role === role)) {
      const f = figureOf(`${s.title}. ${s.text}`);
      if (f) return { ...f, label: f.label || shorten(s.title, 4) };
    }
  return null;
}

/** Three short benefits, from the sections' titles, best roles first. */
export function benefitsOf(sections: Section[], count = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of BENEFIT_ROLES)
    for (const s of sections)
      if (s.role === role && !seen.has(s.title) && out.length < count) {
        seen.add(s.title);
        out.push(shorten(s.title, 4));
      }
  return out;
}

export interface SceneInput {
  copy: Copy;
  sections: Section[];
  /** Where the hero is visible in the take, for the product scene. */
  hero: Scene | null;
}

/**
 * The composition and props of a scene beat. Null when the site has nothing
 * to fill it with (a figure beat on a site that states no number): the beat
 * is skipped rather than shown empty.
 */
export function sceneOf(
  fill: SceneFill,
  composition: string,
  input: SceneInput,
): { composition: string; props: SceneProps; text: string } | null {
  const { copy, sections } = input;
  switch (fill) {
    case "hook":
      return {
        composition,
        // glow-stage, brand-blur: title, brand; orbit-updates: title,
        // subtitle; text-inline-icon: text; chat-typing: the first message.
        props: {
          title: copy.hook,
          brand: copy.name,
          subtitle: copy.name,
          text: copy.hook,
          m1: copy.hook,
        },
        text: copy.hook,
      };
    case "brand":
      return {
        composition,
        props: { brand: copy.name },
        text: copy.name,
      };
    case "product":
      return {
        composition,
        props: {
          screen: RECORDING_SCREEN,
          screenAt: Number((input.hero?.start ?? 0).toFixed(2)),
          // The body follows the capture: a portrait take goes in a phone.
          kind: "auto",
        },
        text: copy.name,
      };
    case "benefits": {
      const b = benefitsOf(sections);
      if (b.length === 0) return null;
      return {
        composition,
        // floating-cards, cards-stack-3d, carousel-3d: card1…; icon-grid-3d: items.
        props: {
          card1: b[0] ?? "",
          card2: b[1] ?? "",
          card3: b[2] ?? "",
          items: b.join(","),
        },
        text: b.join(" · "),
      };
    }
    case "figure": {
      const f = siteFigure(sections);
      if (!f) return null;
      return {
        composition,
        // kinetic-counter: the label goes under the number; no stepping words.
        props: {
          from: 0,
          to: f.value,
          suffix: f.suffix,
          caption: f.label,
          labels: "",
        },
        text: `${f.value}${f.suffix} ${f.label}`.trim(),
      };
    }
  }
}
