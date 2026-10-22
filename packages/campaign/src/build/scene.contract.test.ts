import { SCENE_IDS, sceneFor } from "@goscreen/blocks";
import { describe, expect, it } from "vitest";
import { RECIPES } from "../recipes";
import type { Section } from "../site";
import { figureOf, SCENE_COMPOSITIONS, sceneOf } from "./scene";

// The recipes and the scenes were written apart: a prop the recipe sends that
// the scene does not declare is silently dropped, and the scene shows its
// placeholder words. Every prop a scene beat sends must be one the scene reads.

const sections: Section[] = [
  { role: "hero", title: "Find eggs near you", text: "Fresh eggs." },
  { role: "features", title: "Real stock, live", text: "" },
  { role: "how-it-works", title: "Order in one tap", text: "" },
  { role: "stats", title: "The market", text: "120 trays available today" },
];
const input = {
  copy: {
    hook: "Find *fresh* eggs",
    name: "Brand",
    caption: () => "",
    walkthrough: "",
    cta: "Order",
    url: "brand.app",
  },
  sections,
  hero: null,
};
// Keys the shell consumes before rendering (not page props).
const SHELL_ONLY = new Set(["screenAt"]);

describe("scene beats and scene props", () => {
  it("every scene a recipe names is a built-in scene", () => {
    expect([...SCENE_COMPOSITIONS].sort()).toEqual([...SCENE_IDS].sort());
  });

  const beats = RECIPES.flatMap((r) =>
    r.structure.flatMap((b) =>
      b.kind === "scene"
        ? [{ recipe: r.id, composition: b.composition, fill: b.fill }]
        : [],
    ),
  );

  it("the dynamic recipes have scene beats", () => {
    expect(beats.length).toBeGreaterThan(3);
  });

  for (const beat of beats)
    it(`${beat.recipe}: ${beat.fill} on ${beat.composition} sends props the scene declares`, () => {
      const scene = sceneFor(beat.composition, "16:9");
      expect(scene).toBeTruthy();
      const declared = new Set(scene?.props.map((p) => p.name));
      const out = sceneOf(beat.fill, beat.composition, input);
      expect(out).not.toBeNull();
      const sent = Object.keys(out?.props ?? {}).filter(
        (k) => !SHELL_ONLY.has(k),
      );
      // At least one prop must land (the beat would otherwise show defaults),
      // and every text the beat is about must have a home.
      const landed = sent.filter((k) => declared.has(k));
      expect(
        landed.length,
        `nothing lands on ${beat.composition}`,
      ).toBeGreaterThan(0);
      const words = {
        hook: ["title", "text", "m1"],
        benefits: ["card1", "items"],
        figure: ["to"],
        brand: ["brand"],
        product: ["screen"],
      }[beat.fill];
      expect(
        words.some((w) => declared.has(w) && sent.includes(w)),
        `${beat.fill} words dropped by ${beat.composition}`,
      ).toBe(true);
    });
});

describe("the proof figure", () => {
  it("skips a span of time and reads the next figure", () => {
    expect(
      figureOf("Remises ces 30 derniers jours : 100 plateaux livrés"),
    ).toEqual({
      value: 100,
      suffix: "",
      label: "plateaux livrés",
    });
    expect(figureOf("in the last 7 days")).toBeNull();
    expect(figureOf("12 000 teams")?.value).toBe(12000);
    expect(figureOf("100 plateaux · dès 2 100 FCFA")?.label).toBe("plateaux");
  });
});
