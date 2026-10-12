// The script of a rendered spec (see html.ts). It builds the DOM from the spec
// and one Web Animation per moving part, measured once the fonts are in, so
// any frame can be drawn by seeking `document.getAnimations()` (compose.mjs).
// Kept as plain JavaScript in a string: it runs in a sandboxed page, never in
// the app, and must not depend on how the app is bundled.

export const PAGE_SCRIPT = `
window.__goscreenReady = document.fonts.ready.then(() => {
  const spec = JSON.parse(document.getElementById("spec").textContent);
  const W = spec.width, H = spec.height, D = spec.duration * 1000;
  const root = document.getElementById("film");
  const anims = [];
  const animate = (el, frames, opts) => anims.push(el.animate(frames, { fill: "both", ...opts }));
  const bez = (b) => "cubic-bezier(" + b.join(",") + ")";
  const el = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    parent.appendChild(e);
    return e;
  };
  // Visible exactly in [start, end): equal offsets make an instant switch.
  const window_ = (node, start, end) => {
    const a = Math.max(0, Math.min(1, (start * 1000) / D));
    const b = Math.max(a, Math.min(1, (end * 1000) / D));
    animate(node, [
      { visibility: "hidden", offset: 0 },
      { visibility: "hidden", offset: a },
      { visibility: "visible", offset: a },
      { visibility: "visible", offset: b },
      { visibility: "hidden", offset: b },
      { visibility: "hidden", offset: 1 },
    ], { duration: D, easing: "linear" });
  };

  let lastLine = null; // the previous underline, so the next one grows from it

  const textShot = (shot, frame) => {
    const px = shot.size * H;
    const box = el("div", "text", frame);
    box.style.cssText = "left:" + shot.x * W + "px;font-size:" + px + "px;font-weight:" + shot.weight +
      ";line-height:" + shot.lineHeight + ";color:" + shot.ink;
    let kicker = null;
    if (shot.kicker) {
      kicker = el("div", "kicker", box);
      kicker.textContent = shot.kicker.text;
      kicker.style.cssText = "font-size:" + Math.max(10, px * 0.17) + "px;margin-bottom:" + shot.kicker.gap * px + "px";
    }
    const words = [];
    let probe = null;
    shot.lines.forEach((line, li) => {
      const row = el("div", "line", box);
      line.words.forEach((w, wi) => {
        const span = el("span", "word", row);
        span.textContent = w.text;
        if (w.accent) span.style.color = shot.accent;
        if (wi < line.words.length - 1) span.style.marginRight = "0.26em";
        words.push({ w, span, line: li });
      });
      if (li === shot.lines.length - 1) {
        probe = el("span", "probe", row);
      }
    });
    // Put the last baseline at y.
    const baseline = probe.offsetTop + probe.offsetHeight;
    box.style.top = shot.y * H - baseline + "px";
    const e = shot.enter;
    for (const { w, span } of words) {
      animate(span, [
        { opacity: 0, transform: "translateY(" + e.y + "em) scaleY(1.25)", filter: "blur(" + e.blur * px + "px)" },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ], { delay: w.at * 1000, duration: e.duration * 1000, easing: bez(e.ease) });
      if (w.strike !== undefined) {
        const bar = el("span", "strike", span);
        bar.style.background = shot.accent;
        animate(bar, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          { delay: w.strike * 1000, duration: 300, easing: bez([0.65, 0, 0.35, 1]) });
      }
      if (w.echo) {
        [1, 2].forEach((k) => {
          const ghost = el("span", "echo", span);
          ghost.textContent = w.text;
          ghost.style.color = shot.accent;
          animate(ghost, [
            { opacity: 0, transform: "translateY(0)" },
            { opacity: 0.35 / k, transform: "translateY(" + -0.62 * k + "em)", offset: 0.3 },
            { opacity: 0.35 / k, transform: "translateY(" + -0.62 * k + "em)", offset: 0.8 },
            { opacity: 0, transform: "translateY(" + -0.62 * k + "em)" },
          ], { delay: (w.at + e.duration) * 1000, duration: 1400, easing: "ease-out" });
        });
      }
    }
    if (kicker) animate(kicker, [{ opacity: 0 }, { opacity: 1 }], { delay: shot.kicker.at * 1000, duration: 300 });

    if (shot.underline) {
      const u = shot.underline;
      const left = shot.x * W;
      const lastRow = words.filter((x) => x.line === shot.lines.length - 1);
      const line = el("div", "underline", frame);
      const thick = Math.max(2, u.thickness * px);
      const top = shot.y * H + u.offset * px;
      line.style.cssText = "left:" + left + "px;top:" + top + "px;height:" + thick + "px;background:linear-gradient(90deg," +
        shot.accent + " calc(100% - " + px * 0.6 + "px), transparent)";
      // Width after each word of the last line has come in.
      const from = lastLine && Math.abs(lastLine.top - top) < px * 0.5 ? lastLine.width : 0;
      const stops = [{ t: u.at, w: from }];
      for (const { w, span } of lastRow) {
        const right = span.getBoundingClientRect().right - left + u.overshoot * px;
        stops.push({ t: Math.max(w.at, stops[stops.length - 1].t) + e.duration * 0.5, w: right });
      }
      const t0 = stops[0].t, t1 = stops[stops.length - 1].t;
      const span_ = Math.max(0.001, t1 - t0);
      animate(line, stops.map((s) => ({ width: s.w + "px", offset: (s.t - t0) / span_ })),
        { delay: t0 * 1000, duration: span_ * 1000, easing: "cubic-bezier(.4,0,.2,1)" });
      window_(line, shot.start, shot.end);
      lastLine = { top, width: stops[stops.length - 1].w };
    } else {
      lastLine = null;
    }

    if (shot.exit === "blur") {
      const out = Math.min(0.15, shot.end - shot.start);
      animate(box, [
        { filter: "blur(0px)", opacity: 1, transform: "none" },
        { filter: "blur(" + 0.06 * px + "px)", opacity: 0.4, transform: "translateY(-0.12em) scaleY(1.2)" },
      ], { delay: (shot.end - out) * 1000, duration: out * 1000, easing: "ease-in" });
    }
  };

  for (const shot of spec.shots) {
    const frame = el("div", "shot", root);
    frame.style.background = shot.background;
    window_(frame, shot.start, shot.end);
    if (shot.kind === "text") textShot(shot, frame);
    else {
      lastLine = null;
      const label = el("div", "placeholder", frame);
      label.textContent = shot.label;
    }
  }
  // Paused at 0 until someone plays or seeks (compose.mjs, the preview).
  for (const a of anims) { a.pause(); a.currentTime = 0; }
  window.__goscreenAnimations = anims;
});
`;
