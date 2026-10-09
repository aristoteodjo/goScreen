import {
  activeOverlays,
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

export function fillBackground(ctx: CanvasRenderingContext2D, bg: EditBackground, w: number, h: number) {
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
}

/** Greedy word wrap; explicit line breaks are kept. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
  // Center and wrap width in output px.
  x: number;
  y: number;
  width: number;
};

/** Draws a text block with its reveal (typewriter, words or wipe). */
function drawText(ctx: CanvasRenderingContext2D, b: TextBlock, m: Motion, mode: "typewriter" | "words" | "wipe" | null) {
  ctx.font = `${b.weight} ${b.size * 0.8}px ${b.font}, -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, b.text, b.width);
  const height = lines.length * b.size;
  const top = b.y - height / 2;
  const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const left = b.align === "left" ? b.x - b.width / 2 : b.align === "right" ? b.x + b.width / 2 - widest : b.x - widest / 2;

  if (b.background) {
    const pad = b.size * 0.35;
    ctx.fillStyle = b.background;
    ctx.beginPath();
    ctx.roundRect(left - pad, top - pad * 0.6, widest + pad * 2, height + pad * 1.2, b.size * 0.3);
    ctx.fill();
  }
  if (mode === "wipe") {
    ctx.beginPath();
    ctx.rect(left - b.size, top - b.size, (widest + b.size * 2) * m.reveal, height + b.size * 2);
    ctx.clip();
  }

  ctx.fillStyle = b.color;
  const lineX = (line: string) => {
    const w = ctx.measureText(line).width;
    return b.align === "left" ? b.x - b.width / 2 : b.align === "right" ? b.x + b.width / 2 - w : b.x - w / 2;
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

  let budget = mode === "typewriter" ? Array.from(typedText(lines.join("\n"), m.reveal)).length : Number.POSITIVE_INFINITY;
  lines.forEach((line, row) => {
    if (budget <= 0) return;
    const chars = Array.from(line);
    const shown = chars.slice(0, budget).join("");
    budget -= chars.length + 1;
    ctx.fillText(shown, lineX(line), top + b.size * (row + 0.5));
  });
}

const reveals = (a: string) => (a === "typewriter" || a === "words" || a === "wipe" ? a : null);

/** Applies a motion around a center point; the caller restores. */
function applyMotion(ctx: CanvasRenderingContext2D, m: Motion, cx: number, cy: number, out: Size, rotation = 0) {
  ctx.globalAlpha *= m.opacity;
  ctx.translate(cx + m.dx * out.width, cy + m.dy * out.height);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  if (m.scale !== 1) ctx.scale(m.scale, m.scale);
  ctx.translate(-cx, -cy);
}

/** A title card on the main track. */
export function drawSlide(ctx: CanvasRenderingContext2D, slide: SlideClip, local: number, out: Size) {
  fillBackground(ctx, slide.background, out.width, out.height);
  const m = slideMotion(slide.animation, slide.duration, local);
  const mode = reveals(slide.animation);
  const base = { font: slide.font, color: slide.color, align: "center" as const, background: null, x: out.width / 2, width: out.width * 0.8 };
  const hasSub = slide.subtitle.trim().length > 0;
  for (const [text, motion, y, size, weight] of [
    [slide.title, m.title, hasSub ? out.height * 0.44 : out.height / 2, out.height * 0.1, 700],
    [slide.subtitle, m.subtitle, out.height * 0.6, out.height * 0.045, 500],
  ] as const) {
    if (!text.trim()) continue;
    ctx.save();
    applyMotion(ctx, motion, out.width / 2, y, out);
    drawText(ctx, { ...base, text, y, size, weight }, motion, mode);
    ctx.restore();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: "shape" }>, m: Motion, r: DOMRectLike, out: Size) {
  const stroke = Math.max(1, o.stroke * Math.min(out.width, out.height) * 2);
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (o.shape === "highlight") {
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width * m.reveal, r.height, Math.min(r.height / 4, 12));
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
    ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.reveal);
  } else if (m.reveal >= 1) {
    ctx.roundRect(r.x, r.y, r.width, r.height, Math.min(r.width, r.height) * 0.08);
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
  return { x: o.x * out.width - width / 2, y: o.y * out.height - height / 2, width, height };
}

function drawMedia(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null, r: DOMRectLike, radius: number) {
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
function drawBlur(ctx: CanvasRenderingContext2D, o: Extract<Overlay, { kind: "blur" }>, r: DOMRectLike, out: Size) {
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
    ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, out.width, out.height);
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
      p.drawImage(source, r.x * k, r.y * k, r.width * k, r.height * k, 0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelScratch, 0, 0, w, h, r.x, r.y, r.width, r.height);
    }
  }
  ctx.restore();
}

/** Every overlay showing at timeline time t, above the composed video, in output px. */
export function drawOverlays(ctx: CanvasRenderingContext2D, overlays: Overlay[], t: number, out: Size, mediaOf: MediaOf) {
  for (const o of activeOverlays(overlays, t)) {
    const m = overlayMotion(o, t);
    if (m.opacity <= 0.001) continue;
    const r = overlayBox(o, out);
    ctx.save();
    ctx.globalAlpha = o.opacity;
    applyMotion(ctx, m, r.x + r.width / 2, r.y + r.height / 2, out, o.rotation);
    const short = Math.min(out.width, out.height);
    if (o.kind === "blur") drawBlur(ctx, o, r, out);
    else if (o.kind === "text") drawTextOverlay(ctx, o, m, r, out);
    else if (o.kind === "shape") drawShape(ctx, o, m, r, out);
    else drawMedia(ctx, mediaOf(o), r, o.radius * short);
    ctx.restore();
  }
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, o: TextOverlay, m: Motion, r: DOMRectLike, out: Size) {
  const mode = m.reveal < 1 ? reveals(o.enter) ?? reveals(o.exit) : null;
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
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: r.width,
    },
    m,
    mode,
  );
}
