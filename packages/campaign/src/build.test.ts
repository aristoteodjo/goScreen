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
  figureOf,
  longestStill,
  type Proposal,
  RECIPES,
  SCENES_3D,
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
    expect(calm.clips[1].transition?.kind).toBe("blur");
    expect(fast.clips[1].transition?.kind).toBe("push");
    // Both tones present the screen the SaaS way, on a moving backdrop.
    expect(calm.screen.tilt.x).not.toBe(0);
    expect(calm.background.kind).toBe("mesh");
    expect(fast.touch.style).toBe("ripple");
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

describe("dynamic look", () => {
  const withFigure = {
    ...oeufsdor,
    sections: [
      ...oeufsdor.sections,
      {
        role: "stats" as const,
        title: "Le marché en chiffres",
        text: "12 000 plateaux livrés chaque semaine à Cotonou.",
      },
    ],
  };
  const launch = (
    available?: Parameters<typeof buildEdit>[1]["available"],
    site = withFigure,
  ) =>
    buildEdit(proposal("dynamic-launch", "16:9"), {
      site,
      campaign: defaultCampaign(site),
      duration: DURATION,
      chapters: [],
      available,
    });
  const sceneLayers = (e: ReturnType<typeof build>) =>
    e.overlays.flatMap((o) =>
      o.kind === "video" && o.source && "composition" in o.source ? [o] : [],
    );

  it("lays scenes out as unrendered composition layers that parse as they are", () => {
    const edit = launch();
    const parsed = parseEditState(edit);
    expect(parsed?.overlays).toEqual(edit.overlays);
    const scenes = sceneLayers(edit);
    expect(
      scenes.map(
        (o) => o.source && "composition" in o.source && o.source.composition,
      ),
    ).toEqual([
      "glow-stage",
      "device-3d",
      "floating-cards",
      "chat-typing",
      "kinetic-counter",
    ]);
    for (const o of scenes) {
      expect(o.asset).toBe(`composition:${o.id}`);
      expect(edit.assets.find((a) => a.id === o.asset)).toMatchObject({
        kind: "video",
        file: `${o.id}.pending`,
        duration: o.duration,
      });
      expect([o.x, o.y, o.width, o.height]).toEqual([0.5, 0.5, 1, 1]);
    }
    expect(
      scenes.some(
        (o) =>
          o.source &&
          "composition" in o.source &&
          SCENES_3D.has(o.source.composition),
      ),
    ).toBe(true);
    // Each scene sits on a card of the backdrop, so the main track runs under it.
    const under = edit.clips.filter(
      (c) => c.kind === "slide" && c.title === "",
    );
    expect(under).toHaveLength(scenes.length);
    expect(under[0].kind === "slide" && under[0].background.kind).toBe("mesh");
    const [glow, device, cards, chat, counter] = scenes.map(
      (o) => o.source?.props ?? {},
    );
    expect(glow).toMatchObject({
      title: "Consultez les disponibilités dans votre zone",
      brand: "OEUF D'OR",
    });
    expect(device).toEqual({ screen: "recording", screenAt: 0, kind: "auto" });
    expect(cards).toMatchObject({
      card1: "Comment ça marche",
      card2: "Disponible maintenant",
      card3: "Classement des producteurs",
    });
    expect(chat.m1).toBe(glow.title);
    expect(counter).toEqual({
      from: 0,
      to: 12000,
      suffix: "",
      caption: "plateaux livrés chaque semaine",
      labels: "",
    });
  });

  it("never holds a frame for 2 s, and every clip boundary carries a transition", () => {
    const edit = launch();
    const still = longestStill(edit);
    expect(still.to - still.from, JSON.stringify(still)).toBeLessThanOrEqual(2);
    for (const c of edit.clips.slice(1))
      expect(c.transition?.kind, c.id).toBe("push");
    expect(edit.clips.filter((c) => c.kind === "recording")).toHaveLength(3);
    expect(edit.clips.at(-1)).toMatchObject({
      kind: "slide",
      title: "Découvrir",
      animation: "pop",
    });
    for (const z of edit.zooms) expect(z.scale).toBeLessThanOrEqual(1.15);
    expect(edit.background).toMatchObject({
      kind: "mesh",
      style: "circles",
      base: "#070a10",
    });
    expect(edit.film?.settings).toMatchObject({
      screen: "premium",
      backdrop: "circles",
      brand: "OEUF D'OR",
      captions: "none",
    });
    expect(edit.film?.settings.sound).toBeUndefined();
  });

  it("uses zoomThrough, the beam and film.sound only when the app offers them", () => {
    const edit = launch({
      transitions: ["push", "zoomThrough"],
      backdrops: ["circles", "beam"],
      sound: true,
    });
    for (const c of edit.clips.slice(1))
      expect(c.transition?.kind).toBe("zoomThrough");
    expect(edit.background).toMatchObject({ kind: "mesh", style: "beam" });
    expect(edit.film?.settings).toMatchObject({
      backdrop: "beam",
      sound: "full",
    });
  });

  it("skips a figure the site does not state, and puts a missing scene's words on a card", () => {
    const plain = launch(undefined, oeufsdor);
    expect(
      sceneLayers(plain).map(
        (o) => o.source && "composition" in o.source && o.source.composition,
      ),
    ).not.toContain("kinetic-counter");
    const partial = launch({ compositions: ["glow-stage", "device-3d"] });
    expect(sceneLayers(partial)).toHaveLength(2);
    expect(slides(partial).map((c) => c.title)).toContain(
      "Comment ça marche · Disponible maintenant · Classement des producteurs",
    );
    const [min, max] = recipe("dynamic-launch").duration;
    for (const e of [plain, partial]) {
      expect(sequenceDuration(e.clips)).toBeGreaterThanOrEqual(min);
      expect(sequenceDuration(e.clips)).toBeLessThanOrEqual(max);
    }
  });

  it("the teaser is the same look for 9:16", () => {
    const edit = buildEdit(proposal("dynamic-teaser", "9:16"), {
      site: withFigure,
      campaign: defaultCampaign(withFigure),
      duration: DURATION,
      chapters: [],
    });
    expect(parseEditState(edit)).not.toBeNull();
    expect(
      sceneLayers(edit).map(
        (o) => o.source && "composition" in o.source && o.source.composition,
      ),
    ).toEqual(["glow-stage", "device-3d", "cards-stack-3d", "kinetic-counter"]);
    const still = longestStill(edit);
    expect(still.to - still.from).toBeLessThanOrEqual(2);
  });

  it("reads a figure and its label from a sentence", () => {
    expect(figureOf("12 000 plateaux livrés chaque semaine")).toEqual({
      value: 12000,
      suffix: "",
      label: "plateaux livrés chaque semaine",
    });
    expect(figureOf("Setup in 9 minutes, 98 % renew")).toEqual({
      value: 9,
      suffix: "",
      label: "minutes",
    });
    expect(figureOf("1,500 teams")).toEqual({
      value: 1500,
      suffix: "",
      label: "teams",
    });
    expect(figureOf("9,5 sur 10")).toMatchObject({ value: 9.5 });
    expect(figureOf("Loved by teams")).toBeNull();
  });

  it("longestStill sees a composition as moving and a bare card as still", () => {
    const edit = build(proposal("product-launch", "16:9"));
    const still = longestStill(edit);
    expect(still.to).toBeGreaterThan(still.from);
    const frozen = {
      ...edit,
      clips: [
        {
          ...edit.clips[0],
          kind: "slide" as const,
          duration: 9,
          animation: "none" as const,
        },
      ],
      overlays: [],
      zooms: [],
    };
    expect(longestStill(frozen as typeof edit)).toEqual({ from: 0, to: 9 });
    const covered = {
      ...frozen,
      overlays: [
        {
          id: "s",
          kind: "video" as const,
          lane: 1,
          start: 1,
          duration: 7,
          x: 0.5,
          y: 0.5,
          width: 1,
          height: 1,
          rotation: 0,
          opacity: 1,
          enter: "none" as const,
          exit: "none" as const,
          motion: 0.4,
          asset: "composition:s",
          in: 0,
          volume: 0,
          radius: 0,
          source: { composition: "glow-stage", props: {} },
        },
      ],
    };
    expect(longestStill(covered as typeof edit)).toEqual({ from: 0, to: 1 });
  });
});
