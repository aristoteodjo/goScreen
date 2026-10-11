import { parseEditState } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import {
  buildScenarioEdit,
  EXAMPLE_SCENARIO,
  filmSchema,
  parseScenario,
  requiredVars,
  resolveVars,
  type Scenario,
  scenesOf,
  stepLabel,
  type Take,
  typeset,
} from "./index";

const example = (): Scenario => {
  const parsed = parseScenario(JSON.stringify(EXAMPLE_SCENARIO));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.scenario;
};

const with_ = (patch: object) =>
  parseScenario(JSON.stringify({ ...EXAMPLE_SCENARIO, ...patch }));

describe("parseScenario", () => {
  it("accepts the example and fills defaults", () => {
    const s = example();
    expect(s.colorScheme).toBe("light");
    expect(s.steps).toHaveLength(EXAMPLE_SCENARIO.steps.length);
  });

  it("names the place of each error", () => {
    const r = with_({
      steps: [{ do: "tap", target: { css: "a", text: "b" } }, { do: "fly" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("steps.0.target"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("steps.1"))).toBe(true);
  });

  it("only opens web pages", () => {
    expect(with_({ url: "file:///etc/passwd" }).ok).toBe(false);
    expect(
      with_({ steps: [{ do: "goto", url: "file:///Users/me/.ssh/id_rsa" }] })
        .ok,
    ).toBe(false);
    expect(
      with_({ steps: [{ do: "goto", url: "javascript:alert(1)" }] }).ok,
    ).toBe(false);
    expect(
      with_({ steps: [{ do: "goto", url: "https://x.test/{{order}}" }] }).ok,
    ).toBe(true);
  });

  it("refuses broken JSON, bad masks and unknown keys", () => {
    expect(parseScenario("{").ok).toBe(false);
    expect(with_({ mask: ["("] }).ok).toBe(false);
    expect(with_({ extra: 1 }).ok).toBe(false);
    expect(with_({ steps: [{ do: "scroll" }] }).ok).toBe(false);
    expect(
      with_({ steps: [{ do: "tap", target: { css: "a", name: "x" } }] }).ok,
    ).toBe(false);
  });
});

describe("variables", () => {
  it("lists the values to ask, never the runtime code", () => {
    const s = example();
    s.steps.push({
      do: "type",
      target: { css: "input" },
      text: "{{phone}} {{code}}",
    });
    expect(requiredVars(s).sort()).toEqual(["phone", "task"]);
  });

  it("fills values and defaults, keeps {{code}} for the runner", () => {
    const s = example();
    s.steps.push({
      do: "type",
      target: { css: "input" },
      text: "{{phone}}/{{code}}",
    });
    const r = resolveVars(s, { phone: "0100" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = r.scenario.steps.flatMap((x) =>
      x.do === "type" ? [x.text] : [],
    );
    expect(texts[0]).toBe("Record a product video");
    expect(texts.at(-1)).toBe("0100/{{code}}");
  });

  it("refuses to run with a missing value", () => {
    const s = example();
    s.steps.push({ do: "goto", url: "https://x.test/{{shop}}" });
    expect(resolveVars(s, {})).toEqual({ ok: false, missing: ["shop"] });
  });
});

describe("labels and typesetting", () => {
  it("describes steps in one line", () => {
    expect(
      stepLabel({ do: "tap", target: { role: "button", name: "Pay" } }),
    ).toBe('Tap button "Pay"');
    expect(
      stepLabel({ do: "waitFor", target: { css: "#ok", frame: "iframe" } }),
    ).toBe("Wait for #ok in iframe");
  });

  it("puts French no-break spaces only in French", () => {
    expect(typeset("Vous cherchez ?", "fr-FR")).toBe("Vous cherchez ?");
    expect(typeset("Ready ?", "en-US")).toBe("Ready ?");
  });
});

const layer = {
  instanceId: "glass",
  deviceId: "galaxy-s25",
  colorId: "navy",
  orientation: "portrait" as const,
  screen: { width: 360, height: 780 },
  source: "web" as const,
  rotation: 0,
  rects: [{ t: 0, x: 0, y: 0, width: 1, height: 1 }],
};

const take: Take = {
  duration: 30,
  layers: [layer],
  chapters: [
    { url: "a", start: 0, end: 2 },
    { url: "a", start: 2, end: 10, caption: "First" },
    { url: "a", start: 10, end: 14 },
    { url: "b", start: 14, end: 30, caption: "Second ?" },
  ],
  pointers: [5, 5.1, 20].map((t) => ({
    t,
    kind: "down" as const,
    x: 0.5,
    y: 0.5,
    u: 0.5,
    v: 0.5,
    instanceId: "glass",
    source: "web" as const,
  })),
};

describe("buildScenarioEdit", () => {
  const film = filmSchema.parse({
    intro: { title: "Hi", duration: 3 },
    outro: { title: "Bye", duration: 2 },
  });
  const edit = buildScenarioEdit(take, film, "fr-FR");

  it("keeps captioned scenes only, between the cards", () => {
    expect(edit.clips.map((c) => c.id)).toEqual([
      "intro",
      "scene-0",
      "scene-1",
      "outro",
    ]);
    const rec = edit.clips.filter((c) => c.kind === "recording");
    expect(rec.map((c) => [c.in, c.out])).toEqual([
      [2, 10],
      [14, 30],
    ]);
  });

  it("times each caption on its scene, in timeline seconds", () => {
    const caps = edit.overlays.filter((o) => o.kind === "text");
    expect(caps.map((o) => [o.start, o.duration])).toEqual([
      [3, 8],
      [11, 16],
    ]);
    const second = caps[1];
    expect(second.kind === "text" && second.text).toBe("Second ?");
  });

  it("zooms on taps inside their own scene only", () => {
    for (const z of edit.zooms) {
      const inScene =
        (z.start >= 2 && z.end <= 10) || (z.start >= 14 && z.end <= 30);
      expect(inScene).toBe(true);
    }
    expect(edit.zooms).toHaveLength(2);
  });

  it("is a valid edit the editor opens as is", () => {
    const parsed = parseEditState(JSON.parse(JSON.stringify(edit)));
    expect(parsed).not.toBeNull();
    expect(parsed?.clips).toHaveLength(4);
    expect(parsed?.overlays).toHaveLength(2);
    expect(parsed?.layers?.[0].deviceId).toBe("galaxy-s25");
  });

  it("falls back to the whole take without scenes", () => {
    expect(scenesOf({ ...take, chapters: [] })).toEqual([
      { url: "", start: 0, end: 30 },
    ]);
  });
});

describe("values kept while playing", () => {
  it("never asks for what a remember step sets", () => {
    const r = with_({
      vars: {},
      steps: [
        { do: "goto", url: "https://x.test/" },
        { do: "remember", name: "order", match: "/orders/(\\w+)" },
        { do: "session", name: "seller" },
        { do: "goto", url: "https://x.test/seller/{{order}}" },
        { do: "type", text: "{{code}}" },
        { do: "check", target: { css: "#terms" } },
        { do: "tap", target: { role: "button", name: "+" }, repeat: 9 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(requiredVars(r.scenario)).toEqual([]);
    const resolved = resolveVars(r.scenario, {});
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const goto = resolved.scenario.steps[3];
    expect(goto.do === "goto" && goto.url).toBe(
      "https://x.test/seller/{{order}}",
    );
    expect(resolved.scenario.steps.map(stepLabel).slice(4)).toEqual([
      "Type on the keyboard",
      "Check #terms",
      'Tap button "+" x9',
    ]);
  });

  it("refuses a remember step with a broken pattern or a bad name", () => {
    expect(with_({ steps: [{ do: "remember", name: "a b" }] }).ok).toBe(false);
    expect(
      with_({ steps: [{ do: "remember", name: "a", match: "(" }] }).ok,
    ).toBe(false);
  });
});

describe("values in targets", () => {
  it("fills user values in selectors and leaves remembered ones", () => {
    const r = with_({
      vars: { seller: {} },
      steps: [
        { do: "remember", name: "order" },
        { do: "tap", target: { css: "a", hasText: "{{seller}}" } },
        { do: "tap", target: { css: "a[href$='/{{order}}']" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(requiredVars(r.scenario)).toEqual(["seller"]);
    const resolved = resolveVars(r.scenario, { seller: "Farm" });
    if (!resolved.ok) throw new Error("unresolved");
    const [, a, b] = resolved.scenario.steps;
    expect(a.do === "tap" && a.target.hasText).toBe("Farm");
    expect(b.do === "tap" && b.target.css).toBe("a[href$='/{{order}}']");
  });
});
