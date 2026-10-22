import type { Beat } from "./build/compose";
import type { Format, Objective } from "./campaign";
import type { Role } from "./site";

/**
 * A montage structure, after the genres of the reference playlist. It knows no
 * site and no campaign: only which objectives it serves, which formats it fits
 * and which section roles it needs. `buildEdit` (build/compose.ts) turns it into an EditState.
 */
export interface Recipe {
  id: string;
  label: string;
  /** Best objective first. */
  objectives: Objective[];
  formats: Format[];
  /** Every one of these roles must exist on the site. */
  needs: Role[];
  /** At least one of these must exist (empty = no constraint). */
  needsAny: Role[];
  /** Roles that make the montage richer when present. */
  wants: Role[];
  /** Usual length of the genre, in seconds. */
  duration: [min: number, max: number];
  /** Order of scenes, after the genre of the reference videos. */
  structure: Beat[];
  /**
   * The dynamic look (SaaS motion references): scene compositions, the camera
   * through each element, a beam of the brand hue, a sound per movement.
   */
  dynamic?: boolean;
}

const card = (
  text: "hook" | "name" | "cta" | "walkthrough",
  seconds: number,
): Beat => ({ kind: "card", text, seconds });
const shots = (
  roles: Role[],
  count: number,
  weight: number,
  extra: Partial<Extract<Beat, { kind: "shots" }>> = {},
): Beat => ({
  kind: "shots",
  roles,
  count,
  weight,
  captions: true,
  ...extra,
});

const scene = (
  composition: string,
  fill: Extract<Beat, { kind: "scene" }>["fill"],
  seconds: number,
): Beat => ({ kind: "scene", composition, fill, seconds });

const ALL: Format[] = ["16:9", "9:16", "1:1", "4:5"];
const SOCIAL: Format[] = ["9:16", "1:1", "4:5"];

export const RECIPES: Recipe[] = [
  {
    id: "product-launch",
    label: "Product launch",
    objectives: ["launch", "awareness", "feature"],
    formats: ALL,
    needs: ["hero"],
    needsAny: [],
    wants: ["features", "stats", "cta"],
    duration: [45, 70],
    structure: [
      card("hook", 3),
      card("name", 2.2),
      shots(["hero"], 1, 1, { captions: false }),
      shots(["features", "how-it-works", "listing", "pricing"], 3, 3),
      shots(["stats", "testimonials"], 1, 1),
      card("cta", 3.5),
    ],
  },
  {
    // References Zelios (NeuraFlow, Doks.AI): wordmark and hook on a beam, the
    // product as a 3D object, features as scenes with the real take between
    // them, a figure counting up, the call to action. Never a still 2 s.
    id: "dynamic-launch",
    label: "Dynamic launch",
    objectives: ["launch", "awareness", "feature"],
    formats: ["16:9", "1:1"],
    needs: ["hero"],
    needsAny: [],
    wants: ["features", "stats"],
    duration: [18, 30],
    dynamic: true,
    structure: [
      scene("glow-stage", "hook", 1.5),
      scene("device-3d", "product", 3),
      shots(["hero", "features"], 1, 1, { speed: 1.25, captions: false }),
      scene("floating-cards", "benefits", 3),
      shots(["features", "how-it-works", "listing", "pricing"], 1, 1, {
        speed: 1.25,
      }),
      scene("chat-typing", "hook", 2.5),
      shots(["stats", "pricing", "listing", "testimonials"], 1, 1, {
        speed: 1.25,
      }),
      scene("kinetic-counter", "figure", 2),
      card("cta", 2.5),
    ],
  },
  {
    // Reference AfterRender (9:16): the same look cut to a reel.
    id: "dynamic-teaser",
    label: "Dynamic teaser",
    objectives: ["launch", "awareness", "promo"],
    formats: ["9:16", "4:5"],
    needs: ["hero"],
    needsAny: [],
    wants: ["features", "stats"],
    duration: [12, 20],
    dynamic: true,
    structure: [
      scene("glow-stage", "hook", 1.5),
      scene("device-3d", "product", 2.5),
      shots(["hero", "features", "listing"], 1, 1, {
        speed: 1.5,
        captions: false,
      }),
      scene("cards-stack-3d", "benefits", 2.5),
      scene("kinetic-counter", "figure", 2),
      card("cta", 2),
    ],
  },
  {
    id: "product-demo",
    label: "Product demo",
    objectives: ["feature", "acquisition", "launch"],
    formats: ["16:9", "1:1"],
    needs: [],
    needsAny: ["how-it-works", "features", "listing"],
    wants: ["how-it-works", "features", "listing"],
    duration: [40, 90],
    structure: [
      card("walkthrough", 2.5),
      shots(["how-it-works", "features", "listing"], 4, 1, {
        numbered: true,
        chronological: true,
      }),
      card("cta", 3),
    ],
  },
  {
    id: "video-ad",
    label: "Video ad",
    objectives: ["acquisition", "promo", "launch"],
    formats: SOCIAL,
    needs: ["hero"],
    needsAny: [],
    wants: ["pricing", "stats", "cta"],
    duration: [15, 30],
    structure: [
      card("hook", 1.8),
      shots(["hero", "pricing", "listing", "stats", "features"], 3, 1, {
        speed: 1.25,
      }),
      card("cta", 2.6),
    ],
  },
  {
    id: "explainer",
    label: "Explainer",
    objectives: ["awareness", "acquisition", "recruit-supply"],
    formats: ["16:9", "1:1"],
    needs: ["hero"],
    needsAny: ["how-it-works", "features"],
    wants: ["how-it-works", "features", "stats", "testimonials"],
    duration: [60, 120],
    structure: [
      card("hook", 3.5),
      card("name", 2.5),
      shots(["how-it-works", "features"], 3, 3),
      shots(["stats", "testimonials"], 1, 1),
      card("cta", 4),
    ],
  },
  {
    id: "teaser",
    label: "Teaser",
    objectives: ["launch", "awareness"],
    formats: ALL,
    needs: ["hero"],
    needsAny: [],
    wants: ["stats"],
    duration: [15, 30],
    structure: [
      card("hook", 2),
      shots(["hero", "features", "listing", "stats"], 3, 1, {
        speed: 1.5,
        captions: false,
      }),
      card("name", 2.5),
    ],
  },
  {
    id: "booth-loop",
    label: "Booth loop",
    objectives: ["awareness", "launch"],
    formats: ["16:9"],
    needs: [],
    needsAny: ["listing", "features", "stats"],
    wants: ["listing", "stats"],
    duration: [30, 60],
    structure: [
      card("name", 3),
      shots(["listing", "features", "stats"], 4, 1),
      card("hook", 3),
    ],
  },
  {
    id: "use-case",
    label: "Use case",
    objectives: ["acquisition", "recruit-supply", "awareness"],
    formats: ALL,
    needs: [],
    needsAny: ["listing", "stats"],
    wants: ["listing", "stats", "testimonials"],
    duration: [30, 60],
    structure: [
      card("hook", 2.5),
      shots(["listing", "stats"], 2, 2),
      shots(["testimonials", "how-it-works"], 1, 1),
      card("cta", 3),
    ],
  },
  {
    id: "social-proof",
    label: "Social proof",
    objectives: ["acquisition", "recruit-supply", "awareness"],
    formats: ALL,
    needs: [],
    needsAny: ["testimonials", "stats"],
    wants: ["testimonials", "stats"],
    duration: [20, 45],
    structure: [
      card("hook", 2.2),
      shots(["testimonials", "stats"], 2, 1),
      card("cta", 3),
    ],
  },
  {
    id: "how-it-works",
    label: "How it works",
    objectives: ["recruit-supply", "feature", "acquisition"],
    formats: ALL,
    needs: ["how-it-works"],
    needsAny: [],
    wants: ["cta"],
    duration: [30, 60],
    structure: [
      card("walkthrough", 2.5),
      shots(["how-it-works"], 2, 2, { numbered: true, chronological: true }),
      shots(["cta", "hero"], 1, 1, { captions: false }),
      card("cta", 3),
    ],
  },
  {
    id: "pricing-cta",
    label: "Pricing + CTA",
    objectives: ["promo", "acquisition"],
    formats: ALL,
    needs: ["pricing"],
    needsAny: [],
    wants: ["cta", "testimonials"],
    duration: [15, 30],
    structure: [
      card("hook", 2),
      shots(["pricing"], 1, 2),
      shots(["testimonials", "stats"], 1, 1),
      card("cta", 3),
    ],
  },
];

/** Whether the site has what the recipe needs. */
export function feasible(recipe: Recipe, roles: Set<Role>): boolean {
  return (
    recipe.needs.every((r) => roles.has(r)) &&
    (recipe.needsAny.length === 0 || recipe.needsAny.some((r) => roles.has(r)))
  );
}
