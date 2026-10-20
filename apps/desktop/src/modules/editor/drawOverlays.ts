import {
  activeOverlays,
  animatorAt,
  propsAt,
  type TextAnimator,
  unitsOf,
  type EditBackground,
  type Motion,
  type Overlay,
  overlayMotion,
  type Size,
  type SlideClip,
  slideMotion,
  type TextOverlay,
  typedText,
  wordOpacities,
} from "@goscreen/render-engine";

/** The decoded pixels of an image or video overlay, when ready. */
export type MediaOf = (o: Overlay) => CanvasImageSource | null;

export function fillBackground(
  ctx: CanvasRenderingContext2D,
  bg: EditBackground,
  w: number,
  h: number,
) {
  if (bg.kind === "none") {
    ctx.fillStyle = "#000";
  } else if (bg.kind === "color") {
    ctx.fillStyle = bg.value;
  } else {
    // CSS angles: 0deg points up, clockwise.
    const a = ((bg.angle - 90) * Math.PI) / 180;
    const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createLinearGradient(
      cx - Math.cos(a) * half,
      cy - Math.sin(a) * half,
      cx + Math.cos(a) * half,
      cy + Math.sin(a) * half,
    );
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
  if (bg.kind === "none" || !bg.decor) return;
  for (const d of bg.decor) {
    ctx.save();
    ctx.globalAlpha *= d.opacity;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x * w, d.y * h, d.r * w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
function luminanceOf(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** The frosted plate's veil: light on a dark background, dark on a light one. */
export function plateInk(bg: EditBackground): string {
  const base =
    bg.kind === "color" ? bg.value : bg.kind === "gradient" ? bg.from : null;
  const light = base ? luminanceOf(base) > 0.5 : false;
  return light ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.08)";
}

/** Greedy word wrap; explicit line breaks are kept. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

type TextBlock = {
  text: string;
  font: string;
  // Line height in output px.
  size: number;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  background: string | null;
  bullet?: string | null;
  tracking?: number;
  // Center and wrap width in output px.
  x: number;
  y: number;
  width: number;
};

/** Draws a text block with its reveal (typewriter, words or wipe). */
function drawText(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  m: Motion,
  mode: "typewriter" | "words" | "wipe" | null,
) {
  let b = block;
  ctx.font = `${b.weight} ${b.size * 0.8}px ${b.font}, -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  // WebKit draws letter spacing from Safari 18; older ones ignore it.
  if (b.tracking && "letterSpacing" in ctx)
    ctx.letterSpacing = `${b.tracking * b.size * 0.8}px`;
  if (b.bullet) {
    // A marker at the left edge; the text moves over to make room.
    const d = b.size * 0.5;
    ctx.save();
    ctx.fillStyle = b.bullet;
    ctx.beginPath();
    ctx.arc(b.x - b.width / 2 + d / 2, b.y, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    b = { ...b, x: b.x + d * 0.8, width: b.width - d * 1.6 };
  }
  const lines = wrapLines(ctx, b.text, b.width);
  const height = lines.length * b.size;
  const top = b.y - height / 2;
  const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const left =
    b.align === "left"
      ? b.x - b.width / 2
      : b.align === "right"
        ? b.x + b.width / 2 - widest
        : b.x - widest / 2;

  if (b.background) {
    const pad = b.size * 0.35;
    ctx.fillStyle = b.background;
    ctx.beginPath();
    ctx.roundRect(
      left - pad,
      top - pad * 0.6,
      widest + pad * 2,
      height + pad * 1.2,
      b.size * 0.3,
    );
    ctx.fill();
  }
  if (mode === "wipe") {
    ctx.beginPath();
    ctx.rect(
      left - b.size,
      top - b.size,
      (widest + b.size * 2) * m.reveal,
      height + b.size * 2,
    );
    ctx.clip();
  }

  ctx.fillStyle = b.color;
  const lineX = (line: string) => {
    const w = ctx.measureText(line).width;
    return b.align === "left"
      ? b.x - b.width / 2
      : b.align === "right"
        ? b.x + b.width / 2 - w
        : b.x - w / 2;
  };

  if (mode === "words") {
    const all = lines.flatMap((l) => l.split(" ").filter(Boolean));
    const alpha = wordOpacities(all.length, m.reveal);
    let i = 0;
    lines.forEach((line, row) => {
      let x = lineX(line);
      const y = top + b.size * (row + 0.5);
      for (const word of line.split(" ").filter(Boolean)) {
        const a = alpha[i] ?? 1;
        ctx.save();
        ctx.globalAlpha *= a;
        // Each word rises into place as it appears.
        ctx.fillText(word, x, y + (1 - a) * b.size * 0.35);
        ctx.restore();
        x += ctx.measureText(`${word} `).width;
        i += 1;
      }
    });
    return;
  }

  let budget =
    mode === "typewriter"
      ? Array.from(typedText(lines.join("\n"), m.reveal)).length
      : Number.POSITIVE_INFINITY;
  lines.forEach((line, row) => {
    if (budget <= 0) return;
    const chars = Array.from(line);
    const shown = chars.slice(0, budget).join("");
    budget -= chars.length + 1;
    ctx.fillText(shown, lineX(line), top + b.size * (row + 0.5));
  });
}

const reveals = (a: string) =>
  a === "typewriter" || a === "words" || a === "wipe" ? a : null;

/** Applies a motion around a center point; the caller restores. */
function applyMotion(
  ctx: CanvasRenderingContext2D,
  m: Motion,
  cx: number,
  cy: number,
  out: Size,
  rotation = 0,
) {
  ctx.globalAlpha *= m.opacity;
  ctx.translate(cx + m.dx * out.width, cy + m.dy * out.height);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  if (m.scale !== 1) ctx.scale(m.scale, m.scale);
  ctx.translate(-cx, -cy);
}

/** A title card on the main track. */
export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: SlideClip,
  local: number,
  out: Size,
) {
  fillBackground(ctx, slide.background, out.width, out.height);
  const m = slideMotion(slide.animation, slide.duration, local);
  if (slide.layout === "left") {
    drawBrandCard(ctx, slide, m, out);
    return;
  }
  const mode = reveals(slide.animation);
  const base = {
    font: slide.font,
    color: slide.color,
    align: "center" as const,
    background: null,
    x: out.width / 2,
    width: out.width * 0.8,
  };
  const hasSub = slide.subtitle.trim().length > 0;
  for (const [text, motion, y, size, weight] of [
    [
      slide.title,
      m.title,
      hasSub ? out.height * 0.44 : out.height / 2,
      out.height * 0.1,
      700,
    ],
    [slide.subtitle, m.subtitle, out.height * 0.6, out.height * 0.045, 500],
  ] as const) {
    if (!text.trim()) continue;
    ctx.save();
    applyMotion(ctx, motion, out.width / 2, y, out);
    drawText(ctx, { ...base, text, y, size, weight }, motion, mode);
    ctx.restore();
  }
}

/** Words of a title; `*between stars*` is drawn in the accent colour. */
export function titleWords(title: string): { word: string; accent: boolean }[] {
  const out: { word: string; accent: boolean }[] = [];
  title.split("*").forEach((part, i) => {
    for (const word of part.split(/\s+/).filter(Boolean))
      out.push({ word, accent: i % 2 === 1 });
  });
  return out;
}

/**
 * A brand card, flush left (the VSL look): the brand with its dot, an
 * eyebrow, the title with its accent words, the subtitle. Sizes follow the
 * short side, so a 16:9 card reads like a 9:16 one.
 */
function drawBrandCard(
  ctx: CanvasRenderingContext2D,
  slide: SlideClip,
  m: ReturnType<typeof slideMotion>,
  out: Size,
) {
  const u = Math.min(out.width, out.height) / 1080;
  const left = 96 * u;
  const width = out.width - left * 2;
  const accent = slide.accent ?? slide.color;
  const muted = slide.muted ?? slide.color;
  const font = (w: number, px: number, family: string) =>
    `${w} ${px}px ${family}, -apple-system, system-ui, sans-serif`;
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const gap = 40 * u;
  const titlePx = 104 * u;
  const titleLine = titlePx * 1.04;
  const subPx = 46 * u;
  const subLine = subPx * 1.3;

  ctx.textBaseline = "middle";
  ctx.font = font(800, titlePx, slide.font);
  const words = titleWords(slide.title);
  const rows: { word: string; accent: boolean; x: number }[][] = [[]];
  let x = 0;
  for (const w of words) {
    const wide = ctx.measureText(w.word).width;
    const space = ctx.measureText(" ").width;
    const row = rows[rows.length - 1];
    if (row.length > 0 && x + wide > width) {
      rows.push([{ ...w, x: 0 }]);
      x = wide + space;
    } else {
      row.push({ ...w, x });
      x += wide + space;
    }
  }
  ctx.font = font(400, subPx, slide.font);
  const subRows = slide.subtitle.trim()
    ? wrapLines(ctx, slide.subtitle, Math.min(width, subPx * 12))
    : [];

  const brandH = slide.brand ? 64 * u : 0;
  const eyebrowH = slide.eyebrow ? 32 * u : 0;
  const parts = [
    brandH,
    eyebrowH,
    rows.length * titleLine,
    subRows.length * subLine,
  ].filter((h) => h > 0);
  const total =
    parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
  let y = (out.height - total) / 2;

  ctx.save();
  applyMotion(ctx, m.title, out.width / 2, out.height / 2, out);
  if (slide.brand) {
    const r = 23 * u;
    ctx.fillStyle = accent;
    ctx.save();
    ctx.globalAlpha *= 0.18;
    ctx.beginPath();
    ctx.arc(left + r, y + brandH / 2, r + 14 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(left + r, y + brandH / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = slide.color;
    ctx.font = font(800, 64 * u, slide.font);
    ctx.fillText(slide.brand, left + r * 2 + 22 * u, y + brandH / 2);
    y += brandH + gap;
  }
  if (slide.eyebrow) {
    ctx.fillStyle = muted;
    ctx.font = font(500, 32 * u, mono);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.08 * 32 * u}px`;
    ctx.fillText(slide.eyebrow.toUpperCase(), left, y + eyebrowH / 2);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += eyebrowH + gap;
  }
  ctx.font = font(800, titlePx, slide.font);
  const alpha = wordOpacities(words.length, m.title.reveal);
  let i = 0;
  rows.forEach((row, r) => {
    const cy = y + titleLine * (r + 0.5);
    for (const w of row) {
      const a = alpha[i] ?? 1;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = w.accent ? accent : slide.color;
      ctx.fillText(w.word, left + w.x, cy + (1 - a) * titlePx * 0.3);
      ctx.restore();
      i += 1;
    }
  });
  y += rows.length * titleLine + gap;
  ctx.restore();

  if (subRows.length) {
    ctx.save();
    applyMotion(ctx, m.subtitle, out.width / 2, out.height / 2, out);
    ctx.fillStyle = muted;
    ctx.font = font(400, subPx, slide.font);
    subRows.forEach((line, r) => {
      ctx.fillText(line, left, y + subLine * (r + 0.5));
    });
    ctx.restore();
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  o: Extract<Overlay, { kind: "shape" }>,
  m: Motion,
  r: DOMRectLike,
  out: Size,
) {
  const stroke = Math.max(1, o.stroke * Math.min(out.width, out.height) * 2);
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (o.shape === "highlight") {
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.roundRect(
      r.x,
      r.y,
      r.width * m.reveal,
      r.height,
      Math.min(r.height / 4, 12),
    );
    ctx.fill();
    return;
  }
  if (o.shape === "arrow") {
    // Drawn on along its length when revealed; the head lands at the end.
    const y = r.y + r.height / 2;
    const x0 = r.x;
    const x1 = r.x + r.width * m.reveal;
    const head = Math.min(r.width * 0.3, stroke * 4);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1 - head * 0.3, y);
    ctx.stroke();
    if (m.reveal > 0.05) {
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x1 - head, y - head * 0.6);
      ctx.lineTo(x1 - head, y + head * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  ctx.beginPath();
  if (o.shape === "ellipse") {
    ctx.ellipse(
      r.x + r.width / 2,
      r.y + r.height / 2,
      r.width / 2,
      r.height / 2,
      0,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * m.reveal,
    );
  } else if (m.reveal >= 1) {
    ctx.roundRect(
      r.x,
      r.y,
      r.width,
      r.height,
      Math.min(r.width, r.height) * 0.08,
    );
  } else {
    // Rectangle outline drawn on clockwise.
    const total = 2 * (r.width + r.height);
    let left = total * m.reveal;
    const pts = [
      [r.x + r.width, r.y],
      [r.x + r.width, r.y + r.height],
      [r.x, r.y + r.height],
      [r.x, r.y],
    ];
    let [px, py] = [r.x, r.y];
    ctx.moveTo(px, py);
    for (const [qx, qy] of pts) {
      const len = Math.hypot(qx - px, qy - py);
      const k = Math.min(1, left / len);
      ctx.lineTo(px + (qx - px) * k, py + (qy - py) * k);
      left -= len;
      if (left <= 0) break;
      [px, py] = [qx, qy];
    }
  }
  ctx.stroke();
}

type DOMRectLike = { x: number; y: number; width: number; height: number };

/** Output-pixel box of an overlay (unrotated). */
export function overlayBox(o: Overlay, out: Size): DOMRectLike {
  const width = o.width * out.width;
  const height = o.height * out.height;
  return {
    x: o.x * out.width - width / 2,
    y: o.y * out.height - height / 2,
    width,
    height,
  };
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource | null,
  r: DOMRectLike,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, radius);
  if (!image) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.clip();
  ctx.drawImage(image, r.x, r.y, r.width, r.height);
  ctx.restore();
}

let pixelScratch: HTMLCanvasElement | null = null;

/**
 * Blurs or pixelates what is already painted under the box: the canvas is
 * drawn back onto itself, clipped to the box. Overlays on lower lanes are
 * hidden too; those above stay sharp.
 */
function drawBlur(
  ctx: CanvasRenderingContext2D,
  o: Extract<Overlay, { kind: "blur" }>,
  r: DOMRectLike,
  out: Size,
) {
  const short = Math.min(out.width, out.height);
  const source = ctx.canvas;
  // Output px -> canvas px (the context is scaled by the preview density).
  const k = source.width / out.width;
  ctx.save();
  // Motion and rotation would shift the copy against what it hides: blurs stay put.
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, o.radius * short);
  ctx.clip();
  if (o.mode === "blur") {
    // Bleeding in from outside the box keeps edges blurred, not sharp.
    ctx.filter = `blur(${Math.max(1, o.strength * short * k)}px)`;
    ctx.drawImage(
      source,
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      out.width,
      out.height,
    );
  } else {
    const block = Math.max(2, o.strength * short);
    const w = Math.max(1, Math.round(r.width / block));
    const h = Math.max(1, Math.round(r.height / block));
    pixelScratch ??= document.createElement("canvas");
    pixelScratch.width = w;
    pixelScratch.height = h;
    const p = pixelScratch.getContext("2d");
    if (p) {
      p.imageSmoothingEnabled = true;
      p.drawImage(
        source,
        r.x * k,
        r.y * k,
        r.width * k,
        r.height * k,
        0,
        0,
        w,
        h,
      );
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelScratch, 0, 0, w, h, r.x, r.y, r.width, r.height);
    }
  }
  ctx.restore();
}

/** Every overlay showing at timeline time t, above the composed video, in output px. */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: Overlay[],
  t: number,
  out: Size,
  mediaOf: MediaOf,
) {
  for (const o of activeOverlays(overlays, t)) {
    const m = overlayMotion(o, t);
    if (m.opacity <= 0.001) continue;
    // Keyframes move the overlay; the simple enter/exit motions add on top.
    const p = propsAt(o, t);
    if (p.opacity <= 0.001) continue;
    const r = overlayBox({ ...o, x: p.x, y: p.y }, out);
    ctx.save();
    ctx.globalAlpha = p.opacity;
    applyMotion(
      ctx,
      { ...m, scale: m.scale * p.scale },
      r.x + r.width / 2,
      r.y + r.height / 2,
      out,
      p.rotation,
    );
    const short = Math.min(out.width, out.height);
    if (p.blur > 0 && o.kind !== "blur")
      ctx.filter = `blur(${(p.blur * short).toFixed(2)}px)`;
    if (o.kind === "blur") drawBlur(ctx, o, r, out);
    else if (o.kind === "text" && o.animator)
      drawAnimatedText(ctx, o, o.animator, t - o.start, r, out);
    else if (o.kind === "text") drawTextOverlay(ctx, o, m, r, out);
    else if (o.kind === "shape") drawShape(ctx, o, m, r, out);
    else drawMedia(ctx, mediaOf(o), r, o.radius * short);
    ctx.restore();
  }
}

function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  o: TextOverlay,
  m: Motion,
  r: DOMRectLike,
  out: Size,
) {
  const mode = m.reveal < 1 ? (reveals(o.enter) ?? reveals(o.exit)) : null;
  drawText(
    ctx,
    {
      text: o.text,
      font: o.style.font,
      size: o.style.size * out.height,
      weight: o.style.weight,
      color: o.style.color,
      align: o.style.align,
      background: o.style.background,
      bullet: o.style.bullet,
      tracking: o.style.tracking,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: r.width,
    },
    m,
    mode,
  );
}

/**
 * Text drawn unit by unit (letters, words or lines), each with its own state
 * from the animator: After Effects' text animators.
 */
function drawAnimatedText(
  ctx: CanvasRenderingContext2D,
  o: TextOverlay,
  anim: TextAnimator,
  local: number,
  r: DOMRectLike,
  out: Size,
) {
  const size = o.style.size * out.height;
  ctx.font = `${o.style.weight} ${size * 0.8}px ${o.style.font}, -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, o.text, r.width);
  const height = lines.length * size;
  const top = r.y + r.height / 2 - height / 2;
  const cx = r.x + r.width / 2;
  const lineLeft = (line: string) => {
    const w = ctx.measureText(line).width;
    return o.style.align === "left"
      ? r.x
      : o.style.align === "right"
        ? r.x + r.width - w
        : cx - w / 2;
  };
  if (o.style.background) {
    const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    const left =
      o.style.align === "left"
        ? r.x
        : o.style.align === "right"
          ? r.x + r.width - widest
          : cx - widest / 2;
    const pad = size * 0.35;
    ctx.fillStyle = o.style.background;
    ctx.beginPath();
    ctx.roundRect(
      left - pad,
      top - pad * 0.6,
      widest + pad * 2,
      height + pad * 1.2,
      size * 0.3,
    );
    ctx.fill();
  }

  // Where each unit sits at rest: its left edge in the line, and its width.
  const units = unitsOf(lines, anim.unit);
  const placed: { text: string; x: number; y: number; w: number }[] = [];
  const cursor = lines.map(() => 0);
  for (const u of units) {
    const line = lines[u.line];
    const y = top + size * (u.line + 0.5);
    if (anim.unit === "line") {
      placed.push({
        text: line,
        x: lineLeft(line),
        y,
        w: ctx.measureText(line).width,
      });
      continue;
    }
    // Find the unit in its line after the previous one (spaces are skipped).
    const at = line.indexOf(u.text, cursor[u.line]);
    cursor[u.line] = at + u.text.length;
    const x = lineLeft(line) + ctx.measureText(line.slice(0, at)).width;
    placed.push({ text: u.text, x, y, w: ctx.measureText(u.text).width });
  }

  const states = animatorAt(anim, units.length, local, o.duration);
  const short = Math.min(out.width, out.height);
  ctx.fillStyle = o.style.color;
  placed.forEach((p, i) => {
    const s = states[i];
    if (!s || s.opacity <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= s.opacity;
    if (s.blur > 0) ctx.filter = `blur(${(s.blur * short).toFixed(2)}px)`;
    const ux = p.x + p.w / 2 + s.dx * size;
    const uy = p.y + s.dy * size;
    ctx.translate(ux, uy);
    if (s.rotation) ctx.rotate((s.rotation * Math.PI) / 180);
    if (s.scale !== 1) ctx.scale(s.scale, s.scale);
    ctx.fillText(p.text, -p.w / 2, 0);
    ctx.restore();
  });
}
