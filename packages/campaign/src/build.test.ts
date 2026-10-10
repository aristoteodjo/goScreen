import {
  parseEditState,
  type SlideClip,
  sequenceDuration,
  type TextOverlay,
} from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";

import {
  buildEdit,
  buildProposals,
  type Campaign,
  defaultCampaign,
  type Proposal,
  RECIPES,
  scenesFrom,
  targetDuration,
  toHex,
} from ".";
import { darkSaas, oeufsdor } from "./fixtures/sites";

const DURATION = 90;
const recipe = (id: string) => {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const proposal = (
  id: string,
  format: Proposal["format"],
  variant = 0,
): Proposal => ({ recipe: recipe(id), format, variant, score: 0, reasons: [] });
const base = defaultCampaign(oeufsdor);
const build = (p: Proposal, campaign: Campaign = base, site = oeufsdor) =>
  buildEdit(p, { site, campaign, duration: DURATION, chapters: [] });
const slides = (e: ReturnType<typeof build>) =>
  e.clips.filter((c): c is SlideClip => c.kind === "slide");

describe("buildEdit", () => {
  it("every proposal of several briefs builds a valid, editable montage", () => {
    const briefs: Campaign[] = [
      base,
      { ...base, objective: "launch", channels: ["youtube"] },
      {
        ...base,
        objective: "promo",
        channels: ["instagram-reel", "instagram-feed"],
        tone: "calm",
      },
    ];
    for (const campaign of briefs) {
      for (const p of buildProposals({ site: oeufsdor, campaign })) {
        const edit = build(p, campaign);
        const parsed = parseEditState(edit);
        expect(parsed, p.recipe.id).not.toBeNull();
        expect(parsed?.clips).toHaveLength(edit.clips.length);
        expect(parsed?.overlays).toHaveLength(edit.overlays.length);
        expect(edit.aspect).toBe(p.format);
        for (const c of edit.clips)
          if (c.kind === "recording")
            expect(c.out).toBeLessThanOrEqual(DURATION);
        const [min, max] = p.recipe.duration;
        const length = sequenceDuration(edit.clips);
        expect(length, p.recipe.id).toBeGreaterThanOrEqual(min - 0.01);
        expect(length, p.recipe.id).toBeLessThanOrEqual(max + 0.01);
      }
    }
  });

  it("a product launch follows the genre: hook, logo card, product, proof, CTA", () => {
    const edit = build(proposal("product-launch", "16:9"));
    const [hook, name] = slides(edit);
    const cta = edit.clips.at(-1) as SlideClip;
    expect(edit.clips[0]).toBe(hook);
    expect(hook.title).toBe("Consultez les disponibilités dans votre zone");
    expect(name.title).toBe("OEUF D'OR");
    expect(cta).toMatchObject({
      kind: "slide",
      title: "Découvrir",
      subtitle: "oeufsdor.vercel.app",
      animation: "pop",
    });
    expect(hook.background).toEqual({
      kind: "gradient",
      from: "#e9a100",
      to: expect.stringMatching(/^#/),
      angle: 150,
    });
    expect(hook.font).toBe("Bricolage Grotesque Variable");
    expect(edit.clips.filter((c) => c.kind === "recording")).toHaveLength(5);
    expect(edit.zooms.length).toBeGreaterThan(0);
    expect(sequenceDuration(edit.clips)).toBeCloseTo(
      targetDuration(recipe("product-launch"), base),
    );
  });

  it("a vertical ad cuts fast with captions at the top", () => {
    const edit = build(proposal("video-ad", "9:16"));
    const captions = edit.overlays as TextOverlay[];
    expect(captions.length).toBeGreaterThan(0);
    for (const c of captions) expect(c.y).toBeLessThan(0.2);
    expect(
      edit.clips
        .filter((c) => c.kind === "recording")
        .every((c) => c.kind === "recording" && c.speed > 1),
    ).toBe(true);
  });

  it("a demo walks through the page in order, numbered", () => {
    const edit = build(proposal("product-demo", "16:9"));
    const ins = edit.clips.flatMap((c) =>
      c.kind === "recording" ? [c.in] : [],
    );
    expect(ins).toEqual([...ins].sort((a, b) => a - b));
    expect((edit.overlays[0] as TextOverlay).text).toMatch(/^1 · /);
    expect(slides(edit)[0].title).toBe("Comment ça marche");
  });

  it("variants show other scenes; tones change the cut", () => {
    const ins = (e: ReturnType<typeof build>) =>
      e.clips.flatMap((c) => (c.kind === "recording" ? [c.in] : []));
    expect(ins(build(proposal("use-case", "16:9", 1)))).not.toEqual(
      ins(build(proposal("use-case", "16:9", 0))),
    );
    const calm = build(proposal("product-launch", "16:9"), {
      ...base,
      tone: "calm",
    });
    const fast = build(proposal("product-launch", "16:9"), {
      ...base,
      tone: "energetic",
    });
    expect(calm.clips[1].transition?.kind).toBe("fade");
    expect(fast.clips[1].transition?.kind).toBe("slide-left");
    expect(
      calm.clips[0].kind === "slide" && calm.clips[0].duration,
    ).toBeGreaterThan(
      fast.clips[0].kind === "slide" ? fast.clips[0].duration : 0,
    );
  });

  it("adapts to another brand: English copy, CSS hsl color, brief overrides", () => {
    const campaign = {
      ...defaultCampaign(darkSaas),
      cta: { label: "Start free", url: "https://www.acme.example/signup" },
    };
    const edit = build(proposal("explainer", "16:9"), campaign, darkSaas);
    expect(slides(edit)[0].background).toMatchObject({
      from: toHex("hsl(262 83% 58%)"),
    });
    expect(edit.clips.at(-1)).toMatchObject({
      title: "Start free",
      subtitle: "acme.example",
    });
    const branded = build(
      proposal("explainer", "16:9"),
      { ...campaign, brand: { primary: "#00aa55", font: "Satoshi" } },
      darkSaas,
    );
    expect(slides(branded)[0]).toMatchObject({
      font: "Satoshi",
      background: { from: "#00aa55" },
    });
  });
});

describe("helpers", () => {
  it("normalizes CSS colors to #rrggbb", () => {
    expect(toHex("#ABC")).toBe("#aabbcc");
    expect(toHex("#11223344")).toBe("#112233");
    expect(toHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(toHex("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(toHex("hsl(120, 100%, 25%)")).toBe("#008000");
    expect(toHex("oklch(0.7 0.1 200)")).toBeNull();
  });

  it("spreads each page's sections over its chapter", () => {
    const sections = [
      {
        role: "hero" as const,
        title: "A",
        text: "",
        page: "https://s.example/",
      },
      {
        role: "stats" as const,
        title: "B",
        text: "",
        page: "https://s.example/",
      },
      {
        role: "pricing" as const,
        title: "C",
        text: "",
        page: "https://s.example/prix/",
      },
    ];
    const chapters = [
      { url: "https://s.example/", start: 1, end: 11 },
      { url: "https://s.example/prix", start: 12, end: 20 },
    ];
    expect(
      scenesFrom(sections, chapters, 20).map((s) => [s.title, s.start, s.end]),
    ).toEqual([
      ["A", 1, 6],
      ["B", 6, 11],
      ["C", 12, 20],
    ]);
  });
});

it("never captions the hero with the hook again", () => {
  const edit = build(proposal("video-ad", "9:16"));
  const hook = slides(edit)[0].title;
  for (const o of edit.overlays)
    expect(o.kind === "text" && o.text).not.toBe(hook);
});
