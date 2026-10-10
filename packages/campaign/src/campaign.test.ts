import { describe, expect, it } from "vitest";

import {
  buildProposals,
  type Campaign,
  defaultCampaign,
  formatsFor,
  parseCampaign,
  RECIPES,
} from ".";
import { darkSaas, oeufsdor } from "./fixtures/sites";

const brief = (base: Campaign, patch: Partial<Campaign>): Campaign => ({
  ...base,
  ...patch,
});
const key = (p: { recipe: { id: string }; format: string }) =>
  `${p.recipe.id}@${p.format}`;

describe("campaign", () => {
  it("prefills a brief from what the site says", () => {
    const c = defaultCampaign(oeufsdor);
    expect(c.language).toBe("fr");
    expect(c.cta).toEqual({ label: "Découvrir", url: oeufsdor.url });
    expect(c.objective).toBe("acquisition");
    expect(c.focus.roles).toEqual([
      "how-it-works",
      "listing",
      "stats",
      "pricing",
      "testimonials",
    ]);
    expect(defaultCampaign(darkSaas)).toMatchObject({
      language: "en",
      objective: "awareness",
    });
  });

  it("parses field by field", () => {
    const c = parseCampaign({
      objective: "nope",
      channels: ["tiktok"],
      durationHint: -3,
      tone: "calm",
    });
    expect(c).toMatchObject({
      objective: "awareness",
      channels: ["tiktok"],
      durationHint: null,
      tone: "calm",
    });
    expect(parseCampaign(null).channels).toEqual(["youtube"]);
  });

  it("maps channels to formats, preferred first", () => {
    expect(formatsFor(["instagram-reel", "linkedin", "youtube"])).toEqual([
      "9:16",
      "1:1",
      "16:9",
    ]);
  });
});

describe("buildProposals", () => {
  const base = defaultCampaign(oeufsdor);

  it("returns 8 varied proposals in the campaign's formats", () => {
    const ps = buildProposals({ site: oeufsdor, campaign: base });
    expect(ps).toHaveLength(8);
    const formats = new Set(formatsFor(base.channels));
    for (const p of ps) expect(formats.has(p.format)).toBe(true);
    expect(new Set(ps.map(key)).size).toBe(8);
    expect(new Set(ps.map((p) => p.recipe.id)).size).toBeGreaterThanOrEqual(5);
  });

  it("two briefs on the same site give different galleries", () => {
    const ads = buildProposals({
      site: oeufsdor,
      campaign: brief(base, {
        objective: "acquisition",
        channels: ["instagram-reel"],
      }),
    });
    const launch = buildProposals({
      site: oeufsdor,
      campaign: brief(base, { objective: "launch", channels: ["youtube"] }),
    });
    expect(ads.every((p) => p.format === "9:16")).toBe(true);
    expect(launch.every((p) => p.format === "16:9")).toBe(true);
    expect(ads[0].recipe.objectives).toContain("acquisition");
    expect(launch[0].recipe.id).toBe("product-launch");
    expect(ads.map((p) => p.recipe.id)).not.toEqual(
      launch.map((p) => p.recipe.id),
    );
  });

  it("never proposes a recipe the site cannot feed", () => {
    const ps = buildProposals({
      site: darkSaas,
      campaign: defaultCampaign(darkSaas),
    });
    const ids = new Set(ps.map((p) => p.recipe.id));
    for (const missing of ["pricing-cta", "how-it-works", "use-case"])
      expect(ids.has(missing)).toBe(false);
    expect(ps).toHaveLength(8);
  });

  it("falls back on variants when there are fewer pairs than slots", () => {
    const one = RECIPES.filter((r) => r.id === "teaser");
    const ps = buildProposals({
      site: darkSaas,
      campaign: brief(defaultCampaign(darkSaas), { channels: ["youtube"] }),
      recipes: one,
    });
    expect(ps.map((p) => p.variant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("follows the duration hint", () => {
    const short = buildProposals(
      {
        site: oeufsdor,
        campaign: brief(base, { durationHint: 20, channels: ["youtube"] }),
      },
      3,
    );
    for (const p of short) expect(p.recipe.duration[0]).toBeLessThanOrEqual(30);
  });
});
