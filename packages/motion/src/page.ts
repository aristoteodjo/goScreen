// The script of a rendered spec (see html.ts). It builds the DOM from the spec
// and one Web Animation per moving part, measured once the fonts are in, so
// any frame can be drawn by seeking `document.getAnimations()` (compose.mjs).
// Clips are videos: `__goscreenSeek(t)` seeks each one and resolves once its
// frame is there.
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

  const assets = root.dataset.assets || "";
  const counters = [];
  const pending = []; // work that needs a label's final place
  const loads = [];
  const clips = [];
  const offset = (t) => Math.max(0, Math.min(1, (t * 1000) / D));
  // Opacity over the whole film: 0, fade in from \`at\`, 1, fade out to \`until\`.
  const fades = (node, from, fadeIn, to, fadeOut) => {
    const a = offset(from), b = Math.max(a, offset(from + fadeIn));
    const d = offset(to), c = Math.max(b, Math.min(d, offset(to - fadeOut)));
    animate(node, [
      { opacity: fadeIn > 0 ? 0 : 1, offset: 0 },
      { opacity: fadeIn > 0 ? 0 : 1, offset: a },
      { opacity: 1, offset: b },
      { opacity: 1, offset: c },
      { opacity: fadeOut > 0 ? 0 : 1, offset: d },
      { opacity: fadeOut > 0 ? 0 : 1, offset: 1 },
    ], { duration: D, easing: "linear" });
  };
  // Sets the source and resolves once the picture (or a clip's first frame) is in.
  const load = (node, name) => new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Could not load " + name));
    const timer = setTimeout(fail, 20000);
    const ok = () => { clearTimeout(timer); resolve(); };
    if (node.tagName === "VIDEO") {
      node.addEventListener("loadeddata", ok, { once: true });
      node.addEventListener("error", fail, { once: true });
      node.src = assets + encodeURIComponent(name);
    } else {
      node.src = assets + encodeURIComponent(name);
      node.decode().then(ok, fail);
    }
  });

  // A picture: a box (placed, softened at its edges, moved) holding the image
  // or clip and the patches that hide its words while the text is drawn.
  const visual = (v, shot, frame) => {
    const node = el("div", "visual", frame);
    const media = el(v.kind === "clip" ? "video" : "img", "media", node);
    const left = v.x * W, top = v.y * H, w = v.w * W, h = v.h * H;
    // Soft edges, except where it touches the frame (it would show a seam).
    const f = Math.max(2, Math.min(w, h) * 0.02);
    const edge = (near) => (near ? "0px" : f + "px");
    const fx = "linear-gradient(90deg,transparent,#000 " + edge(left <= 1) + ",#000 calc(100% - " + edge(left + w >= W - 1) + "),transparent)";
    const fy = "linear-gradient(180deg,transparent,#000 " + edge(top <= 1) + ",#000 calc(100% - " + edge(top + h >= H - 1) + "),transparent)";
    node.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + w + "px;height:" + h + "px;" +
      "-webkit-mask-image:" + fx + "," + fy + ";-webkit-mask-composite:source-in;mask-image:" + fx + "," + fy + ";mask-composite:intersect";
    if (v.kind === "clip") {
      media.muted = true;
      media.playsInline = true;
      media.preload = "auto";
      clips.push({ node: media, at: v.at, until: v.until });
    }
    loads.push(load(media, v.src));
    const from = Math.max(v.at, shot.start), to = Math.min(v.until, shot.end);
    // A child shown with \`visibility\` shows even when its parent is hidden:
    // a patch's window stays inside its picture's.
    for (const c of v.covers || []) {
      const patch = el("div", "cover", node);
      // The colour around the word, its edges softened: on a gradient a hard
      // edge would show. (Not the plate: it may hold the very word.)
      const soft = Math.min(c.w * W, c.h * H) * 0.25 + "px";
      const fx = "linear-gradient(90deg,transparent,#000 " + soft + ",#000 calc(100% - " + soft + "),transparent)";
      const fy = "linear-gradient(180deg,transparent,#000 " + soft + ",#000 calc(100% - " + soft + "),transparent)";
      patch.style.cssText = "left:" + (c.x * W - left) + "px;top:" + (c.y * H - top) + "px;width:" + c.w * W +
        "px;height:" + c.h * H + "px;background:" + c.color + ";-webkit-mask-image:" + fx + "," + fy +
        ";-webkit-mask-composite:source-in;mask-image:" + fx + "," + fy + ";mask-composite:intersect";
      window_(patch, Math.max(c.at, from), Math.max(Math.max(c.at, from), Math.min(c.until, to)));
    }
    window_(node, from, to);
    fades(node, v.at, v.fadeIn, v.until, v.fadeOut);
    if (v.path.length) {
      const cx = left + w / 2, cy = top + h / 2;
      const at = (p) => "translate(" + (p.x * W - cx) + "px," + (p.y * H - cy) + "px) scale(" + p.scale + ")";
      const first = v.path[0], last = v.path[v.path.length - 1];
      animate(node, [
        { transform: at(first), offset: 0 },
        ...v.path.map((p) => ({ transform: at(p), offset: offset(p.t) })),
        { transform: at(last), offset: 1 },
      ], { duration: D, easing: "linear" });
    }
  };

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
    const rows = [];
    shot.lines.forEach((line, li) => {
      const row = el("div", "line", box);
      if (line.size) row.style.fontSize = line.size * H + "px";
      rows.push({ line, row, probe: null });
      line.words.forEach((w, wi) => {
        const span = el("span", "word", row);
        span.textContent = w.text;
        if (w.count) counters.push({ text: span.firstChild, count: w.count, to: Number(w.text) });
        if (w.accent) span.style.color = shot.accent;
        else if (w.color) span.style.color = w.color;
        if (wi < line.words.length - 1) span.style.marginRight = "0.26em";
        words.push({ w, span, line: li });
      });
      rows[li].probe = el("span", "probe", row);
      if (li === shot.lines.length - 1) probe = rows[li].probe;
    });
    // Each measured word is fitted on the reference's letters: as wide (its
    // letter spacing, within reason: the font is not the same) and at the same
    // place, left to right. The ink is measured, as OCR measured it.
    const ink = document.createElement("canvas").getContext("2d");
    const letters = new Map(); // span -> its ink, from its left edge
    for (const { w, span } of words) {
      if (w.x === undefined) continue;
      const cs = getComputedStyle(span);
      ink.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      const n = [...w.text].length;
      const base = parseFloat(cs.letterSpacing) || 0;
      ink.letterSpacing = base + "px";
      let m = ink.measureText(w.text);
      if (w.w !== undefined && n > 1) {
        const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const size = parseFloat(cs.fontSize);
        const extra = Math.max(-0.08 * size, Math.min(0.15 * size, (w.w * W - width) / (n - 1)));
        span.style.letterSpacing = base + extra + "px";
        ink.letterSpacing = base + extra + "px";
        m = ink.measureText(w.text);
      }
      const origin = span.getBoundingClientRect().left;
      const delta = w.x * W - (origin - m.actualBoundingBoxLeft);
      span.style.marginLeft = (parseFloat(span.style.marginLeft) || 0) + delta + "px";
      letters.set(span, { left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight });
    }
    if (rows.every((r) => r.line.y !== undefined)) {
      // Every line on its measured baseline, top to bottom; the kicker above
      // the first one.
      box.style.top = "0px";
      if (kicker) kicker.style.cssText += ";position:absolute;left:0;top:0";
      for (const { line, row, probe: p } of rows) {
        const baseline = p.offsetTop + p.offsetHeight;
        row.style.marginTop = (parseFloat(row.style.marginTop) || 0) + line.y * H - baseline + "px";
      }
      if (kicker) kicker.style.top = rows[0].row.offsetTop - kicker.offsetHeight - shot.kicker.gap * px + "px";
    } else {
      // Put the last baseline at y.
      const baseline = probe.offsetTop + probe.offsetHeight;
      box.style.top = shot.y * H - baseline + "px";
    }
    const e = shot.enter;
    for (const { w, span } of words) {
      animate(span, [
        { opacity: 0, transform: "translateY(" + e.y + "em) scaleY(1.25)", filter: "blur(" + e.blur * px + "px)" },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ], { delay: w.at * 1000, duration: e.duration * 1000, easing: bez(e.ease) });
      if (w.strike !== undefined) {
        const bar = el("span", "strike", span);
        bar.style.background = shot.accent;
        // Over the letters, as drawn in the reference, not the word's box.
        const l = letters.get(span);
        if (l) bar.style.cssText += ";left:" + (l.left - px * 0.02) + "px;right:auto;width:" + (l.right - l.left + px * 0.04) + "px";
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
      const left = (u.x ?? shot.x) * W;
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

  // A word of a slide: still, at its measured baseline.
  const label = (l, shot, frame) => {
    const px = l.size * H;
    const node = el("div", "label", frame);
    node.style.cssText = "left:" + l.x * W + "px;font-size:" + px + "px;font-weight:" + l.weight + ";color:" + l.color;
    node.textContent = l.text;
    // A counter shows its number of the moment (set at each seek).
    if (l.count) counters.push({ text: node.firstChild, count: l.count, to: Number(l.text) });
    const probe = el("span", "probe", node);
    // Fitted on the reference's letters, as a word of a text shot.
    const cs = getComputedStyle(node);
    const ink = document.createElement("canvas").getContext("2d");
    ink.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const base = parseFloat(cs.letterSpacing) || 0;
    ink.letterSpacing = base + "px";
    let m = ink.measureText(l.text);
    const n = [...l.text].length;
    let scale = 1;
    if (l.w !== undefined && n > 3) {
      const extra = Math.max(-0.08 * px, Math.min(0.15 * px, (l.w * W - (m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) / (n - 1)));
      node.style.letterSpacing = base + extra + "px";
      ink.letterSpacing = base + extra + "px";
      m = ink.measureText(l.text);
    } else if (l.w !== undefined) {
      // A short word (a figure): spacing its few letters would pull them
      // apart; it is narrowed or widened a little instead.
      scale = Math.max(0.8, Math.min(1.25, (l.w * W) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight || 1)));
      node.style.transformOrigin = "0 0";
      node.style.transform = "scaleX(" + scale + ")";
    }
    node.style.left = l.x * W + m.actualBoundingBoxLeft * scale + "px";
    // Its measured moves (a counter zooming in), around its letters' centre.
    if (l.path && l.path.length) {
      const nodeLeft = l.x * W + m.actualBoundingBoxLeft * scale;
      const cx = (l.x + (l.w ?? 0) / 2) * W, cy = l.y * H - px * 0.36;
      const at = (p) => "translate(" + (p.x * W - cx) + "px," + (p.y * H - cy) + "px) scale(" + p.scale + ")" + (scale !== 1 ? " scaleX(" + scale + ")" : "");
      pending.push(() => {
        node.style.transformOrigin = (cx - nodeLeft) + "px " + (cy - parseFloat(node.style.top)) + "px";
        const first = l.path[0], last = l.path[l.path.length - 1];
        animate(node, [
          { transform: at(first), offset: 0 },
          ...l.path.map((p) => ({ transform: at(p), offset: offset(p.t) })),
          { transform: at(last), offset: 1 },
        ], { duration: D, easing: "linear" });
      });
    }
    node.style.top = l.y * H - (probe.offsetTop + probe.offsetHeight) + "px";
    while (pending.length) pending.shift()();
    window_(node, Math.max(l.at, shot.start), Math.min(l.until, shot.end));
    fades(node, l.at, l.fadeIn, l.until, 0);
  };

  for (const shot of spec.shots) {
    const frame = el("div", "shot", root);
    frame.style.background = shot.background;
    window_(frame, shot.start, shot.end);
    // The background as it is, under everything.
    if (shot.plate) {
      const plate = el("img", "plate", frame);
      loads.push(load(plate, shot.plate));
    }
    // Pictures first: the text is drawn over them.
    for (const v of shot.visuals || []) visual(v, shot, frame);
    if (shot.kind === "text") textShot(shot, frame);
    else {
      lastLine = null;
      for (const l of shot.labels || []) label(l, shot, frame);
      if (!(shot.visuals || []).length && !(shot.labels || []).length) {
        const label = el("div", "placeholder", frame);
        label.textContent = shot.label;
      }
    }
  }
  // Paused at 0 until someone plays or seeks (compose.mjs, the preview).
  for (const a of anims) { a.pause(); a.currentTime = 0; }
  window.__goscreenAnimations = anims;

  // A clip shows its frame at t - at; only the ones on screen are sought.
  const seekClip = (node, time) => new Promise((resolve) => {
    if (Math.abs(node.currentTime - time) < 0.001 || !(node.duration > 0)) return resolve();
    const timer = setTimeout(resolve, 3000);
    node.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
    node.currentTime = time;
  });
  const countAt = (c, t) => {
    const k = Math.max(0, Math.min(1, (t - c.count.start) / Math.max(0.001, c.count.end - c.count.start)));
    // Eases out, as counters do: fast, then settling on the value.
    return Math.round(c.count.from + (c.to - c.count.from) * (1 - Math.pow(1 - k, 2)));
  };
  window.__goscreenSeek = (t) => {
    for (const c of counters) c.text.nodeValue = String(countAt(c, t));
    return seekClips(t);
  };
  const seekClips = (t) => Promise.all(
    clips
      .filter((c) => t >= c.at && t < c.until)
      .map((c) => seekClip(c.node, Math.max(0, Math.min(c.node.duration - 0.001, t - c.at)))),
  );
  return Promise.all(loads);
});
`;
