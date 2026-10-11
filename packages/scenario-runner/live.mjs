// Live mode: the page is streamed to the studio and the user acts on it.
// Each click, typing or scroll is played on the real site and sent back as
// a scenario step whose target was found here, so nobody has to read the
// site's code. Commands come on stdin, one JSON object per line.

import { createInterface } from "node:readline";
import { candidatesOrder, fromGlass } from "./lib.mjs";

const FRAME_EVERY_MS = 120;

// Runs in the page: what sits at a point, and every way to name it.
function describeAt({ x, y }) {
  const ACTIONABLE =
    "button, a[href], input, select, textarea, summary, label, [role=button], [role=link], [role=option], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [contenteditable=true]";
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  if (hit.tagName === "IFRAME") {
    const r = hit.getBoundingClientRect();
    return { frame: true, x: x - r.left, y: y - r.top };
  }
  const el = hit.closest(ACTIONABLE) || hit;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const short = (s) => (s.length > 80 ? "" : s);
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const ROLE_OF_INPUT = {
    checkbox: "checkbox",
    radio: "radio",
    number: "spinbutton",
    range: "slider",
    button: "button",
    submit: "button",
    reset: "button",
    search: "searchbox",
  };
  const role =
    el.getAttribute("role") ||
    (tag === "a" && el.hasAttribute("href") ? "link" : null) ||
    (tag === "button" ? "button" : null) ||
    (tag === "select" ? "combobox" : null) ||
    (tag === "textarea" ? "textbox" : null) ||
    (tag === "input"
      ? (ROLE_OF_INPUT[type] ?? (type === "password" ? null : "textbox"))
      : null) ||
    (/^h[1-6]$/.test(tag) ? "heading" : null) ||
    (tag === "img" ? "img" : null);
  const byId = (ids) =>
    clean(
      (ids || "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
  const labelText = () => {
    if (el.labels?.length) return clean(el.labels[0].textContent);
    return "";
  };
  const field = ["input", "select", "textarea"].includes(tag);
  const name = short(
    clean(el.getAttribute("aria-label")) ||
      byId(el.getAttribute("aria-labelledby")) ||
      (field ? labelText() : "") ||
      (field ? "" : clean(el.innerText || el.textContent)) ||
      clean(el.getAttribute("alt")) ||
      clean(el.getAttribute("title")) ||
      (tag === "input" && ["submit", "button"].includes(type)
        ? clean(el.value)
        : ""),
  );
  // Ids that frameworks generate change from one load to the next.
  const stableId = (id) =>
    id &&
    !/^(radix|react|headlessui|:r|mui|ember|ext-gen)|[:]|\d{4,}/i.test(id);
  const cssPath = () => {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 6) {
      if (stableId(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const t = node.tagName.toLowerCase();
      const same = node.parentElement
        ? [...node.parentElement.children].filter(
            (c) => c.tagName === node.tagName,
          )
        : [];
      parts.unshift(
        same.length > 1 ? `${t}:nth-of-type(${same.indexOf(node) + 1})` : t,
      );
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const r = el.getBoundingClientRect();
  return {
    frame: false,
    box: { x: r.left, y: r.top, width: r.width, height: r.height },
    tag,
    editable:
      (field &&
        !["checkbox", "radio", "button", "submit", "reset", "range"].includes(
          type,
        )) ||
      el.isContentEditable,
    checkable: tag === "input" && ["checkbox", "radio"].includes(type),
    checked: !!el.checked,
    candidates: {
      testId: el.getAttribute("data-testid") || undefined,
      role: role && name ? { role, name } : undefined,
      label: field ? labelText() || undefined : undefined,
      placeholder: clean(el.getAttribute("placeholder")) || undefined,
      text:
        !field && name && clean(el.innerText) === name && name.length <= 40
          ? name
          : undefined,
      id: stableId(el.id) ? `#${CSS.escape(el.id)}` : undefined,
      css: cssPath(),
    },
  };
}

// Which candidate finds exactly this element in Playwright (first wins).
async function chooseTarget(root, info, handle) {
  for (const target of candidatesOrder(info.candidates)) {
    const loc =
      target.testId !== undefined
        ? root.getByTestId(target.testId)
        : target.role !== undefined
          ? root.getByRole(target.role, { name: target.name, exact: true })
          : target.label !== undefined
            ? root.getByLabel(target.label, { exact: true })
            : target.placeholder !== undefined
              ? root.getByPlaceholder(target.placeholder, { exact: true })
              : target.text !== undefined
                ? root.getByText(target.text, { exact: true })
                : root.locator(target.css);
    try {
      const index = await loc.evaluateAll((els, el) => els.indexOf(el), handle);
      if (index < 0) continue;
      const count = await loc.count();
      const exact =
        target.role !== undefined ||
        target.label !== undefined ||
        target.placeholder !== undefined ||
        target.text !== undefined;
      return {
        ...target,
        ...(exact ? { exact: true } : {}),
        ...(count > 1 ? { nth: index } : {}),
      };
    } catch {
      // A selector the engine rejects: try the next way.
    }
  }
  return null;
}

/** The element under a glass point, its target and box, frames included. */
async function pick(page, u, v) {
  const vv = await page.evaluate(() => {
    const v = window.visualViewport;
    return v
      ? { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height }
      : { x: 0, y: 0, width: innerWidth, height: innerHeight };
  });
  let point = fromGlass(u, v, vv);
  let frame = page.mainFrame();
  let frameCss;
  let offset = { x: 0, y: 0 };
  let info = await frame.evaluate(describeAt, point);
  // Payment widgets and embeds: look inside the iframe once.
  if (info?.frame) {
    const iframe = await frame.evaluateHandle(
      ({ x, y }) => document.elementFromPoint(x, y),
      point,
    );
    const inner = await iframe.asElement()?.contentFrame();
    if (!inner) return null;
    frameCss = await iframe.evaluate((f) => {
      if (f.id) return `iframe#${CSS.escape(f.id)}`;
      try {
        return `iframe[src*='${new URL(f.src).host}']`;
      } catch {
        return f.name ? `iframe[name='${f.name}']` : "iframe";
      }
    });
    const r = await iframe.evaluate((f) => {
      const b = f.getBoundingClientRect();
      return { x: b.left, y: b.top };
    });
    offset = r;
    point = { x: info.x, y: info.y };
    frame = inner;
    info = await frame.evaluate(describeAt, point);
  }
  if (!info || info.frame) return null;
  const handle = await frame.evaluateHandle(
    ({ x, y, sel }) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest(sel) || hit;
    },
    {
      ...point,
      sel: "button, a[href], input, select, textarea, summary, label, [role=button], [role=link], [role=option], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [contenteditable=true]",
    },
  );
  // The frame itself answers for its own elements (same selectors as the
  // frame locator the runner will use).
  const target = await chooseTarget(frame, info, handle);
  await handle.dispose();
  if (!target) return null;
  if (frameCss) target.frame = frameCss;
  const box = info.box;
  return {
    target,
    editable: info.editable,
    checkable: info.checkable,
    checked: info.checked,
    // Back to glass fractions, for the studio's highlight.
    box: {
      u: (box.x + offset.x - vv.x) / vv.width,
      v: (box.y + offset.y - vv.y) / vv.height,
      w: box.width / vv.width,
      h: box.height / vv.height,
    },
  };
}

/**
 * Serves the studio until it says stop. `ctx` brings the page in use, the
 * runner's own helpers (locate, fill, codes) and `emit`.
 */
export async function serveLive(ctx) {
  const { emit, viewport } = ctx;
  let lastFrameAt = 0;
  let latest = null;
  let cdp = null;
  let streamed = null;

  const stream = async () => {
    const page = ctx.page();
    if (streamed === page) return;
    if (cdp) await cdp.send("Page.stopScreencast").catch(() => {});
    streamed = page;
    cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", (f) => {
      latest = f.data;
      cdp
        .send("Page.screencastFrameAck", { sessionId: f.sessionId })
        .catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      maxWidth: Math.round(viewport.width * 1.5),
      maxHeight: Math.round(viewport.height * 1.5),
      everyNthFrame: 1,
    });
  };
  await stream();
  const frames = setInterval(() => {
    if (!latest || Date.now() - lastFrameAt < FRAME_EVERY_MS) return;
    lastFrameAt = Date.now();
    emit({ type: "frame", jpeg: latest, url: ctx.page().url() });
    latest = null;
  }, 40);

  const recorded = (step) => emit({ type: "recorded", step });
  emit({ type: "ready", url: ctx.page().url() });

  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      continue;
    }
    if (cmd.cmd === "stop") break;
    const page = ctx.page();
    try {
      switch (cmd.cmd) {
        case "inspect": {
          const found = await pick(page, cmd.u, cmd.v);
          emit({ type: "inspect", id: cmd.id, found });
          break;
        }
        case "tap": {
          const found = await pick(page, cmd.u, cmd.v);
          if (!found) {
            emit({ type: "warn", message: "Nothing to act on there." });
            break;
          }
          if (cmd.act === false) {
            emit({ type: "picked", found });
            break;
          }
          if (found.checkable) {
            await ctx.locate(page, found.target).click();
            recorded({
              do: "check",
              target: found.target,
              value: !found.checked,
            });
          } else {
            await ctx.locate(page, found.target).click();
            recorded({ do: "tap", target: found.target });
          }
          emit({ type: "picked", found });
          break;
        }
        case "type": {
          // `text` is what the step keeps ({{phone}}); `value` is typed now.
          const value = await ctx.fill(page, cmd.value ?? cmd.text);
          if (cmd.target) {
            const loc = ctx.locate(page, cmd.target);
            if (cmd.clear) await loc.fill("");
            await loc.pressSequentially(value, { delay: 40 });
            recorded({
              do: "type",
              target: cmd.target,
              text: cmd.text,
              ...(cmd.clear ? { clear: true } : {}),
            });
          } else {
            await page.keyboard.type(value, { delay: 40 });
            recorded({ do: "type", text: cmd.text });
          }
          break;
        }
        case "press":
          await page.keyboard.press(cmd.key);
          recorded({ do: "press", key: cmd.key });
          break;
        case "scroll":
          await page.mouse.wheel(0, cmd.by);
          recorded({ do: "scroll", by: Math.round(cmd.by), duration: 1000 });
          break;
        case "goto":
          await ctx.open(page, cmd.url);
          recorded({ do: "goto", url: cmd.url });
          break;
        case "back":
          await page.goBack({ waitUntil: "load" }).catch(() => {});
          break;
        case "record":
          // A wait is only written down; anything else is played first.
          if (cmd.step.do !== "wait") await ctx.play(cmd.step);
          recorded(cmd.step);
          break;
      }
    } catch (e) {
      emit({ type: "warn", message: String(e?.message ?? e).split("\n")[0] });
    }
    await stream().catch(() => {});
  }
  clearInterval(frames);
  if (cdp) await cdp.send("Page.stopScreencast").catch(() => {});
}
