import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  blockById,
  escapeHtml,
  renderHtml,
  resolveProps,
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

  it("ids are unique", () => {
    expect(new Set(BLOCKS.map((b) => b.id)).size).toBe(BLOCKS.length);
  });
});
