// Inspect mode: what an AI needs to write steps for a page without seeing
// its code: the outline, the visible text, and every element a visitor can
// act on, each with a target the runner has checked it can find again.

import { ACTIONABLE, chooseTarget, describeElement } from "./live.mjs";

const MAX_ELEMENTS = 150;

export async function inspectPage(page) {
  const outline = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || null,
      scrollY: Math.round(scrollY),
      pageHeight: document.documentElement.scrollHeight,
      headings: [...document.querySelectorAll("h1, h2, h3")]
        .map((h) => ({
          level: Number(h.tagName[1]),
          text: clean(h.textContent),
        }))
        .filter((h) => h.text)
        .slice(0, 40),
      text: clean(document.body?.innerText).slice(0, 4000),
      iframes: [...document.querySelectorAll("iframe")].map((f) => {
        let css = "iframe";
        if (f.id) css = `iframe#${CSS.escape(f.id)}`;
        else
          try {
            css = `iframe[src*='${new URL(f.src).host}']`;
          } catch {}
        return { css, src: f.src || null };
      }),
    };
  });

  const elements = [];
  const handles = await page.$$(ACTIONABLE);
  for (const handle of handles) {
    if (elements.length >= MAX_ELEMENTS) break;
    try {
      if (!(await handle.isVisible())) continue;
      const info = await handle.evaluate(describeElement);
      const target = await chooseTarget(page, info, handle);
      if (!target) continue;
      elements.push({
        // The step a person would most likely take on it.
        step: info.editable ? "type" : info.checkable ? "check" : "tap",
        target,
        tag: info.tag,
        // Where it sits: y in page pixels (scroll to it if below the fold).
        box: {
          x: Math.round(info.box.x),
          y: Math.round(info.box.y + outline.scrollY),
          width: Math.round(info.box.width),
          height: Math.round(info.box.height),
        },
      });
    } catch {
      // Detached while we looked: skip it.
    } finally {
      await handle.dispose().catch(() => {});
    }
  }

  const shot = await page
    .screenshot({ type: "jpeg", quality: 60, scale: "css" })
    .then((b) => b.toString("base64"))
    .catch(() => null);
  return { ...outline, elements, screenshot: shot };
}
