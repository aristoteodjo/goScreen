import { formatsFor, type Campaign, type Format } from "./campaign";
import { feasible, RECIPES, type Recipe } from "./recipes";
import { rolesOf, type Role, type Site } from "./site";

/** Why a proposal was chosen, as codes the UI translates. */
export type Reason =
  | { kind: "objective"; rank: number }
  | { kind: "channel"; format: Format; primary: boolean }
  | { kind: "has"; role: Role }
  | { kind: "focus"; role: Role }
  | { kind: "duration"; fits: boolean };

export interface Proposal {
  recipe: Recipe;
  format: Format;
  /** 0 for the first take of a (recipe, format); higher values focus other sections. */
  variant: number;
  score: number;
  reasons: Reason[];
}

export interface ProposalContext {
  site: Site;
  campaign: Campaign;
  recipes?: Recipe[];
}

/** How well a recipe in a format serves this campaign on this site. */
export function scoreCandidate(
  recipe: Recipe,
  format: Format,
  roles: Set<Role>,
  campaign: Campaign,
): { score: number; reasons: Reason[] } {
  const reasons: Reason[] = [];
  let score = 0;

  const rank = recipe.objectives.indexOf(campaign.objective);
  if (rank >= 0) {
    score += 8 - 3 * rank;
    reasons.push({ kind: "objective", rank });
  }

  const primary = formatsFor(campaign.channels)[0] === format;
  score += primary ? 2 : 1;
  reasons.push({ kind: "channel", format, primary });

  for (const role of recipe.wants) {
    if (!roles.has(role)) continue;
    score += 1;
    reasons.push({ kind: "has", role });
    if (campaign.focus.roles.includes(role)) {
      score += 1;
      reasons.push({ kind: "focus", role });
    }
  }

  if (campaign.durationHint !== null) {
    const [min, max] = recipe.duration;
    const d = campaign.durationHint;
    const fits = d >= min && d <= max;
    score += fits ? 2 : -2 * Math.ceil(Math.max(min - d, d - max) / 10);
    reasons.push({ kind: "duration", fits });
  }

  return { score, reasons };
}

/** Penalties that keep the gallery varied. */
const SAME_RECIPE = 2.5;
const SAME_FORMAT = 1;
const SAME_PAIR = 4;

/**
 * The `count` best proposals: every feasible (recipe, format) pair is scored,
 * then picked greedily with penalties for repeating a recipe or a format. When
 * there are fewer pairs than `count`, a pair comes back as another variant.
 */
export function buildProposals({ site, campaign, recipes = RECIPES }: ProposalContext, count = 8): Proposal[] {
  const roles = rolesOf(site.sections);
  const formats = formatsFor(campaign.channels);
  const candidates = recipes
    .filter((r) => feasible(r, roles))
    .flatMap((recipe) =>
      formats
        .filter((f) => recipe.formats.includes(f))
        .map((format) => ({ recipe, format, ...scoreCandidate(recipe, format, roles, campaign) })),
    );
  if (candidates.length === 0) return [];

  const picked: Proposal[] = [];
  const times = (pred: (p: Proposal) => boolean) => picked.filter(pred).length;
  while (picked.length < count) {
    let best: (typeof candidates)[number] | undefined;
    let bestValue = -Infinity;
    for (const c of candidates) {
      const value =
        c.score -
        SAME_RECIPE * times((p) => p.recipe.id === c.recipe.id) -
        SAME_FORMAT * times((p) => p.format === c.format) -
        SAME_PAIR * times((p) => p.recipe.id === c.recipe.id && p.format === c.format);
      if (value > bestValue) {
        best = c;
        bestValue = value;
      }
    }
    if (!best) break;
    const chosen = best;
    picked.push({ ...chosen, variant: times((p) => p.recipe.id === chosen.recipe.id && p.format === chosen.format) });
  }
  return picked;
}
