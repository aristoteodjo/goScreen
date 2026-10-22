import { describe, expect, it } from "vitest";
import {
  compositionIssues,
  isSceneId,
  parseComposition,
  prepareCompositionHtml,
  SCENE_BOXES,
  SCENE_IDS,
  SCENES,
  sceneFor,
} from "./index.ts";

const EXPECTED = [
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
];

describe("scenes", () => {
  it("ships every scene of the library, each a valid composition", () => {
    expect(SCENE_IDS).toEqual(EXPECTED);
    for (const s of SCENES) {
      const r = parseComposition(s);
      expect(r.ok, `${s.id}: ${JSON.stringify(r)}`).toBe(true);
      expect(s.html.length).toBeGreaterThan(500);
      // Drawn by setT, deterministic: no CSS animation, no timers.
      expect(s.html).toContain("window.setT=function(t)");
      expect(s.html).not.toMatch(
        /@keyframes|animation:|setTimeout|setInterval/,
      );
      // Colours are props, so the film can fill them.
      expect(
        s.props.some((p) => p.name === "accent" && p.type === "color"),
      ).toBe(true);
    }
    expect(new Set(SCENE_IDS).size).toBe(SCENES.length);
  });

  it("only the plates are opaque; a screen scene takes an asset name", () => {
    const opaque = SCENES.filter((s) => !s.transparent).map((s) => s.id);
    expect(opaque).toEqual(["glow-stage", "brand-blur"]);
    for (const id of ["device-3d", "floating-cards", "brand-blur"]) {
      const s = SCENES.find((x) => x.id === id);
      expect(s?.props.find((p) => p.name === "screen")?.type).toBe("text");
      expect(s?.html).toContain("http://goscreen.assets/");
    }
  });

  it("every scene's script compiles (an invalid regex kills the whole page)", () => {
    for (const s of SCENES) {
      const scripts = [...s.html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      expect(scripts.length, s.id).toBeGreaterThan(0);
      for (const [, code] of scripts)
        expect(() => new Function(code), s.id).not.toThrow();
    }
  });

  it("fits a scene to a format, the page unchanged", () => {
    const s = sceneFor("device-3d", "9:16");
    expect(s?.box).toEqual(SCENE_BOXES["9:16"]);
    expect(s?.html).toBe(SCENES[1].html);
    expect(sceneFor("device-3d", "auto")?.box).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(sceneFor("device-3d", "weird")?.box).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(sceneFor("nope")).toBeNull();
    expect(isSceneId("glow-stage")).toBe(true);
    expect(isSceneId("glow")).toBe(false);
    expect(compositionIssues(s)).toEqual([]);
  });

  it("substitutes props and keeps the prelude first", () => {
    const html = prepareCompositionHtml(
      SCENES[0],
      { accent: "#ff0000" },
      { width: 640, height: 360 },
    );
    expect(html.indexOf("window.__props")).toBeLessThan(
      html.indexOf("window.setT"),
    );
    expect(html).toContain('"accent":"#ff0000"');
  });

  it("a page may use a montage asset by name, nothing else remote", () => {
    const base = {
      ...SCENES[0],
      html: '<img src="http://goscreen.assets/shot.png">',
    };
    expect(compositionIssues(base)).toEqual([]);
    expect(
      compositionIssues({
        ...base,
        html: '<img src="http://goscreen.assets.evil.com/x.png">',
      }).map((i) => i.path),
    ).toEqual(["html"]);
    expect(
      compositionIssues({
        ...base,
        html: "<style>a{background:url(//cdn.example/x.png)}</style>",
      }).map((i) => i.path),
    ).toEqual(["html"]);
  });
});
