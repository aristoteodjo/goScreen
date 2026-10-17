import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  blockById,
  chartPath,
  escapeHtml,
  renderHtml,
  resolveProps,
  titleSize,
} from "./index";

describe("blocks", () => {
  it("every block renders a full page at its size, without scripts", () => {
    for (const b of BLOCKS) {
      const html = renderHtml(b, {}, { width: 801, height: 451 });
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("width:802px");
      expect(html).not.toMatch(/<script/i);
      expect(b.props.length).toBeGreaterThan(0);
    }
  });

  it("fills defaults and keeps given values", () => {
    const b = blockById("stat-counter");
    if (!b) throw new Error("missing");
    const p = resolveProps(b, { value: 42 });
    expect(p.value).toBe("42");
    expect(p.label).toBe("available today");
    expect(renderHtml(b, { value: 42 }, { width: 400, height: 200 })).toContain(
      "--n:42",
    );
  });

  it("escapes text so props never become markup", () => {
    expect(escapeHtml(`<b onclick="x">'&`)).toBe(
      "&lt;b onclick=&quot;x&quot;&gt;&#39;&amp;",
    );
    const b = blockById("kinetic-title");
    if (!b) throw new Error("missing");
    const html = renderHtml(
      b,
      { title: "<img src=x onerror=alert(1)>" },
      { width: 400, height: 200 },
    );
    expect(html).not.toContain("<img");
  });

  it("refuses colours that are not plain hex", () => {
    const b = blockById("lower-third");
    if (!b) throw new Error("missing");
    const html = renderHtml(
      b,
      { accent: "red;}</style><script>" },
      { width: 400, height: 100 },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("#e9a100");
  });

  it("draws a line chart through its points, highest at the top", () => {
    const { line, end } = chartPath("10, 30, 20", { width: 1000, height: 500 });
    expect(line).toBe("M40 460 L470 150 L900 305");
    expect(end).toEqual({ x: 900, y: 305 });
    // Too few numbers: a plain rising line rather than nothing.
    expect(chartPath("oops", { width: 100, height: 100 }).line).toMatch(
      /^M\d+ \d+ L\d+ \d+$/,
    );
  });

  it("types an input one character at a time, escaped", () => {
    const b = blockById("prompt-input");
    if (!b) throw new Error("missing");
    const html = renderHtml(b, { text: "a<b" }, { width: 800, height: 160 });
    expect(html.match(/class="k"/g)).toHaveLength(3);
    expect(html).toContain("&lt;");
    expect(html).not.toContain("a<b");
  });

  it("shows typing dots before each reply, never before your own messages", () => {
    const b = blockById("chat-bubbles");
    if (!b) throw new Error("missing");
    const html = renderHtml(
      b,
      { messages: "hi\nhello\nok\nfine" },
      { width: 600, height: 600 },
    );
    expect(html.match(/class="dots"/g)).toHaveLength(2);
    expect(html.match(/class="row me"/g)).toHaveLength(2);
  });

  it("shrinks a long headline so it never runs off the sides", () => {
    const box = { width: 972, height: 486 };
    expect(titleSize("Ship it", box)).toBe(126);
    // 32 letters: two lines of 16, about 96 px each.
    expect(titleSize("Vous dormez, vos œufs se vendent", box)).toBe(96);
  });

  it("ids are unique", () => {
    expect(new Set(BLOCKS.map((b) => b.id)).size).toBe(BLOCKS.length);
  });
});
