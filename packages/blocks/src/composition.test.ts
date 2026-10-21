import { describe, expect, it } from "vitest";
import {
  blockById,
  compositionFromBlock,
  compositionIssues,
  EXAMPLE_COMPOSITION,
  fnv1a,
  parseComposition,
  prepareCompositionHtml,
  renderFingerprint,
  resolveCompositionProps,
  substituteProps,
} from "./index";

const base = { ...EXAMPLE_COMPOSITION };
const size = { width: 641, height: 361 };

describe("compositions", () => {
  it("accepts the example and names every issue with its path", () => {
    expect(compositionIssues(base)).toEqual([]);
    const bad = compositionIssues({
      ...base,
      id: "Bad Id",
      duration: 0,
      props: [
        { name: "a", label: "A", type: "color", default: "red" },
        { name: "a", label: "A", type: "text", default: "" },
      ],
    }).map((i) => i.path);
    expect(bad).toContain("id");
    expect(bad).toContain("duration");
    const r = parseComposition({
      ...base,
      props: [
        { name: "a", label: "A", type: "color", default: "red" },
        { name: "a", label: "A", type: "text", default: "" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues.map((i) => i.path).sort()).toEqual([
        "props.0.default",
        "props.1.name",
      ]);
  });

  it("refuses network, Math.random and oversized pages, explicitly", () => {
    const messages = (html: string) =>
      compositionIssues({ ...base, html }).map((i) => i.message);
    expect(messages('<img src="https://x.test/a.png">').join()).toMatch(
      /network/,
    );
    expect(messages("<style>a{background:url(//x.test/a.png)}</style>").join()).toMatch(
      /network/,
    );
    expect(messages("<script>fetch('/a')</script>").join()).toMatch(/fetch/);
    expect(messages("<script>var r=Math.random()</script>").join()).toMatch(
      /window\.random/,
    );
    expect(messages(`<p>${"x".repeat(300 * 1024)}`).join()).toMatch(/KB/);
    // data: URLs stay local.
    expect(messages('<img src="data:image/png;base64,AA==">')).toEqual([]);
  });

  it("fills props with defaults and refuses bad colours and numbers", () => {
    const c = {
      ...base,
      props: [
        ...base.props,
        { name: "n", label: "N", type: "number" as const, default: 3 },
      ],
    };
    expect(resolveCompositionProps(c, { accent: "red", n: "x" })).toEqual({
      text: "New",
      accent: "#e9a100",
      ink: "#16241c",
      n: "3",
    });
    expect(resolveCompositionProps(c, { text: "Hi", n: 7 }).n).toBe("7");
  });

  it("substitutes {{name}} escaped and leaves unknown names alone", () => {
    expect(
      substituteProps("<b>{{ text }}</b> {{missing}}", { text: "<i>&" }),
    ).toBe("<b>&lt;i&gt;&amp;</b> {{missing}}");
  });

  it("prepares a page with the prelude before the page's own scripts", () => {
    const html = prepareCompositionHtml(base, { text: "</script>" }, size);
    expect(html).toContain('"width":642,"height":362');
    const prelude = html.indexOf("window.__goscreenSeek");
    const own = html.indexOf("window.setT=function");
    expect(prelude).toBeGreaterThan(-1);
    expect(prelude).toBeLessThan(own);
    // The prop never closes the prelude's script tag.
    expect(html).toContain('"text":"\\u003c/script>"');
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("window.requestAnimationFrame=function(){return 0;}");
    // A page without <head> still gets the prelude first.
    const bare = prepareCompositionHtml(
      { ...base, html: "<p>{{text}}</p>" },
      {},
      size,
    );
    expect(bare.startsWith("<script>")).toBe(true);
    expect(bare.endsWith("<p>New</p>")).toBe(true);
  });

  it("drives setT in real time only for a preview", () => {
    const still = prepareCompositionHtml(base, {}, size);
    const live = prepareCompositionHtml(base, {}, size, { preview: true });
    expect(still).not.toContain("function tick");
    expect(live).toContain("function tick");
  });

  it("fingerprints a render by page, size, length and rate", () => {
    const a = { html: "<p>", width: 100, height: 100, fps: 30, duration: 2, transparent: true };
    expect(renderFingerprint(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(renderFingerprint(a)).toBe(renderFingerprint({ ...a }));
    expect(renderFingerprint(a)).not.toBe(renderFingerprint({ ...a, fps: 25 }));
    expect(renderFingerprint(a)).not.toBe(renderFingerprint({ ...a, html: "<b>" }));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("seeds random numbers from the page so two renders agree", () => {
    const a = prepareCompositionHtml(base, {}, size);
    const seed = /window\.random\(([0-9]+)\)/.exec(a)?.[1];
    expect(seed).toBeDefined();
    expect(prepareCompositionHtml(base, {}, size)).toContain(`random(${seed})`);
    expect(prepareCompositionHtml({ ...base, html: `${base.html} ` }, {}, size)).not.toContain(
      `random(${seed})`,
    );
  });

  it("turns a catalogue block into an editable composition", () => {
    const block = blockById("stat-counter");
    if (!block) throw new Error("missing");
    const c = compositionFromBlock(block, { value: 42 }, { width: 401, height: 201 });
    expect(c.id).toBe("stat-counter-custom");
    expect(c.box).toEqual({ width: 402, height: 202 });
    expect(c.html).toContain("--n:42");
    expect(compositionIssues(c)).toEqual([]);
  });
});
