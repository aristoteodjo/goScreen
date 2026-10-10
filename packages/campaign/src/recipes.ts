import type { Format, Objective } from "./campaign";
import type { Role } from "./site";

/**
 * A montage structure, after the genres of the reference playlist. It knows no
 * site and no campaign: only which objectives it serves, which formats it fits
 * and which section roles it needs. Building the EditState lives in render-engine.
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
}

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
  },
];

/** Whether the site has what the recipe needs. */
export function feasible(recipe: Recipe, roles: Set<Role>): boolean {
  return (
    recipe.needs.every((r) => roles.has(r)) &&
    (recipe.needsAny.length === 0 || recipe.needsAny.some((r) => roles.has(r)))
  );
}
