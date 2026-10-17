import {
  type Aspect,
  type Direction,
  directionOf,
  type Genre,
  type Technique,
} from "./direction";
import type { Category, Entry } from "./library";

// Finding the right inspiration: by words, by genre (what kind of film), by
// technique (how it is made), by format. Directions are read once per entry.

export type Inspiration = Entry & { direction: Direction };

export function withDirections(entries: Entry[]): Inspiration[] {
  return entries.map((e) => ({ ...e, direction: directionOf(e.prompt) }));
}

export type SearchQuery = {
  text?: string;
  category?: Category;
  genres?: Genre[];
  techniques?: Technique[];
  aspect?: Aspect;
  limit?: number;
};

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);

/** Higher is closer; 0 means it does not match the filters. */
export function score(i: Inspiration, q: SearchQuery): number {
  const d = i.direction;
  if (q.category && i.category !== q.category) return 0;
  if (q.aspect && d.aspect && d.aspect !== q.aspect) return 0;
  let s = 1;
  for (const g of q.genres ?? []) if (d.genres.includes(g)) s += 3;
  for (const t of q.techniques ?? []) if (d.techniques.includes(t)) s += 2;
  if (q.genres?.length && !q.genres.some((g) => d.genres.includes(g))) return 0;
  if (q.text) {
    const hay =
      `${i.author} ${i.slug} ${i.tech_tags.join(" ")} ${i.prompt}`.toLowerCase();
    const asked = words(q.text);
    const hits = asked.filter((w) => hay.includes(w)).length;
    if (asked.length && hits === 0) return 0;
    s += hits * 2;
  }
  // A whole prompt with a direction to follow beats a one-line description.
  if (!i.prompt_partial) s += 1;
  if (d.structure.length) s += 1;
  if (d.palette.length >= 2) s += 0.5;
  if (i.has_remake) s += 0.5;
  return s;
}

export function search(all: Inspiration[], q: SearchQuery): Inspiration[] {
  return all
    .map((i) => ({ i, s: score(i, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.i.added.localeCompare(a.i.added))
    .slice(0, q.limit ?? 20)
    .map((x) => x.i);
}

// Montage recipes (@goscreen/campaign) and the genres of film they belong to.
const RECIPE_GENRES: Record<string, Genre[]> = {
  "product-launch": ["launch", "brand"],
  "product-demo": ["demo"],
  "video-ad": ["ad"],
  explainer: ["explainer"],
  teaser: ["ad", "launch"],
  "booth-loop": ["brand", "launch"],
  "use-case": ["demo", "explainer"],
  "social-proof": ["ad", "data"],
  "how-it-works": ["explainer", "demo"],
  "pricing-cta": ["ad"],
};

export function genresForRecipe(recipe: string): Genre[] {
  return RECIPE_GENRES[recipe] ?? [];
}

/** Counts per genre and technique, for filters that show what exists. */
export function facets(all: Inspiration[]) {
  const genres: Partial<Record<Genre, number>> = {};
  const techniques: Partial<Record<Technique, number>> = {};
  for (const i of all) {
    for (const g of i.direction.genres) genres[g] = (genres[g] ?? 0) + 1;
    for (const t of i.direction.techniques)
      techniques[t] = (techniques[t] ?? 0) + 1;
  }
  return { genres, techniques };
}
