import {
  activeOverlays,
  animatorAt,
  type CaptionWord,
  captionStateAt,
  propsAt,
  type TextAnimator,
  unitsOf,
  type EditBackground,
  type FloatLook,
  type Motion,
  type Overlay,
  overlayMotion,
  type Size,
  type SlideClip,
  slideMotion,
  type TextOverlay,
  typedText,
  wordOpacities,
  hexToHsl,
  hslToHex,
  type MeshBackground,
  meshAt,
  sharp,
} from "@goscreen/render-engine";

/** The decoded pixels of an image or video overlay, when ready. */
export type MediaOf = (o: Overlay) => CanvasImageSource | null;

export function fillBackground(
  ctx: CanvasRenderingContext2D,
  bg: EditBackground,
  w: number,
  h: number,
  t = 0,
) {
  if (bg.kind === "mesh") {
    drawMesh(ctx, bg, w, h, t);
  } else {
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

// The mesh is painted small (the blur is huge anyway) and scaled up; the
// grain is one fixed tile so it never shimmers between frames.
let meshCanvas: HTMLCanvasElement | null = null;
let meshSmall: HTMLCanvasElement | null = null;
let grainTile: HTMLCanvasElement | null = null;
const MESH_SCALE = 1 / 6;

function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 192;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const img = g.createImageData(size, size);
    // Deterministic noise: the same tile in the preview and the export.
    let seed = 1234567;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = seed % 256;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  grainTile = c;
  return c;
}

/** A cinematic background at time t: blurred shapes, static grain, vignette. */
function drawMesh(
  ctx: CanvasRenderingContext2D,
  bg: MeshBackground,
  w: number,
  h: number,
  t: number,
) {
  const mw = Math.max(8, Math.round(w * MESH_SCALE));
  const mh = Math.max(8, Math.round(h * MESH_SCALE));
  meshCanvas ??= document.createElement("canvas");
  const m = meshCanvas;
  if (m.width !== mw) m.width = mw;
  if (m.height !== mh) m.height = mh;
  const g = m.getContext("2d");
  if (!g) return;
  const frame = meshAt(bg, t);
  const short = Math.min(mw, mh);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = bg.base;
  g.fillRect(0, 0, mw, mh);
  g.save();
  g.translate(mw / 2, mh / 2);
  g.rotate(frame.rotation);
  g.translate(-mw / 2, -mh / 2);
  // Each shape is a radial gradient whose edge fades over the blur
  // distance: soft without relying on the context's filter (not every
  // WebKit applies it), then the whole mesh is smoothed by resampling.
  for (const sh of frame.shapes) {
    const rx = sh.rx * mw;
    const ry = sh.ry * mh;
    const r = Math.max(rx, ry);
    const soft = Math.min(
      1,
      (bg.blur * short * (1 + sh.soft)) / Math.max(1, r),
    );
    g.save();
    g.translate(sh.x * mw, sh.y * mh);
    g.scale(rx / r, ry / r);
    const R = r * (1 + soft);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    if (sh.hole) {
      // A ring: empty inside, soft on both edges.
      const inner = r * sh.hole;
      const edge = Math.min(inner, soft * r);
      rg.addColorStop(0, `${sh.color}00`);
      rg.addColorStop(Math.max(0, inner - edge) / R, `${sh.color}00`);
      rg.addColorStop(Math.min(1, inner / R), sh.color);
    } else {
      rg.addColorStop(0, sh.color);
    }
    rg.addColorStop(Math.max(0, 1 - soft) / (1 + soft), sh.color);
    rg.addColorStop(1, `${sh.color}00`);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, r * (1 + soft), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.restore();
  // Two passes of down- and up-sampling: a cheap, wide blur.
  meshSmall ??= document.createElement("canvas");
  const sw = Math.max(2, Math.round(mw / 6));
  const shh = Math.max(2, Math.round(mh / 6));
  if (meshSmall.width !== sw) meshSmall.width = sw;
  if (meshSmall.height !== shh) meshSmall.height = shh;
  const sg = meshSmall.getContext("2d");
  if (sg) {
    for (let pass = 0; pass < 2; pass += 1) {
      sg.imageSmoothingEnabled = true;
      sg.imageSmoothingQuality = "high";
      sg.clearRect(0, 0, sw, shh);
      sg.drawImage(m, 0, 0, sw, shh);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(meshSmall, 0, 0, mw, mh);
    }
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(m, 0, 0, w, h);
  if (bg.grain > 0) {
    const pattern = ctx.createPattern(grain(), "repeat");
    if (pattern) {
      ctx.globalAlpha = bg.grain;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }
  if (bg.vignette > 0) {
    const r = Math.hypot(w, h) / 2;
    const v = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
    v.addColorStop(0, "rgba(0, 0, 0, 0)");
    v.addColorStop(1, `rgba(0, 0, 0, ${0.7 * bg.vignette})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
function luminanceOf(hex: string): number {
  const c = [1, 3, 5].map(
    (i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const lin = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** The frosted plate's veil: light on a dark background, dark on a light one. */
export function plateInk(bg: EditBackground): string {
  const base =
    bg.kind === "color"
      ? bg.value
      : bg.kind === "gradient"
        ? bg.from
        : bg.kind === "mesh"
          ? bg.base
          : null;
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
  // Emphasis (see TextStyle): accent words, flash, glow, shadow, sweep.
  accent?: string | null;
  flash?: boolean;
  glow?: number;
  shadow?: number;
  sweep?: boolean;
  // Seconds since the text appeared, for the flash, glow and sweep.
  local?: number;
};

const hasEmphasis = (b: TextBlock) =>
  Boolean(b.accent || b.flash || b.glow || b.shadow || b.sweep);

/** #rrggbb lightened towards white by k (0..1), with an optional hue turn. */
function lighten(hex: string, k: number, hueTurn = 0): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + hueTurn, s * (1 - k * 0.4), l + (1 - l) * k);
}

/** The glow envelope: up during the entrance, peak after it, long decay. */
function glowEnvelope(local: number): number {
  if (local <= 0) return 0;
  if (local < 0.45) return local / 0.45;
  return 0.25 + 0.75 * Math.exp(-(local - 0.45) / 0.9);
}

type EmphWord = { word: string; accent: boolean; x: number; w: number };

/**
 * Text with the course's emphasis: words laid out by hand so that accent
 * words can be heavier and a little bigger; hard shadow, light gradient on
 * accent words, colour flash and light sweep on entry, glow that peaks after.
 */
function drawEmphasisText(
  ctx: CanvasRenderingContext2D,
  b: TextBlock,
  m: Motion,
  mode: "typewriter" | "words" | "wipe" | null,
) {
  const px = b.size * 0.8;
  const fontOf = (accent: boolean) =>
    `${accent ? Math.max(b.weight, 900) : b.weight} ${accent ? px * 1.12 : px}px ${b.font}, -apple-system, system-ui, sans-serif`;
  const words = titleWords(b.text);
  // Wrap by measured widths, accent words measured at their own size.
  const rows: EmphWord[][] = [[]];
  let x = 0;
  for (const w of words) {
    ctx.font = fontOf(w.accent);
    const wide = ctx.measureText(w.word).width;
    const space = ctx.measureText(" ").width;
    const row = rows[rows.length - 1];
    if (row.length > 0 && x + wide > b.width) {
      rows.push([{ ...w, x: 0, w: wide }]);
      x = wide + space;
    } else {
      row.push({ ...w, x, w: wide });
      x += wide + space;
    }
  }
  const rowWidth = (row: EmphWord[]) =>
    row.length ? row[row.length - 1].x + row[row.length - 1].w : 0;
  const widest = Math.max(1, ...rows.map(rowWidth));
  const height = rows.length * b.size;
  const top = b.y - height / 2;
  const leftOf = (row: EmphWord[]) =>
    b.align === "left"
      ? b.x - b.width / 2
      : b.align === "right"
        ? b.x + b.width / 2 - rowWidth(row)
        : b.x - rowWidth(row) / 2;

  if (b.background) {
    const pad = b.size * 0.35;
    const left =
      b.align === "left"
        ? b.x - b.width / 2
        : b.align === "right"
          ? b.x + b.width / 2 - widest
          : b.x - widest / 2;
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
      b.x - widest / 2 - b.size,
      top - b.size,
      (widest + b.size * 2) * m.reveal,
      height + b.size * 2,
    );
    ctx.clip();
  }

  const local = b.local ?? 10;
  const all = rows.flat();
  const alpha =
    mode === "words" ? wordOpacities(all.length, m.reveal) : all.map(() => 1);
  let typed =
    mode === "typewriter"
      ? Array.from(typedText(all.map((w) => w.word).join(" "), m.reveal)).length
      : Number.POSITIVE_INFINITY;
  const accent = b.accent ?? b.color;
  // Flash: two colours, three frames each, then the effect fades in three.
  const flashColor = (() => {
    if (!b.flash || local >= 0.3) return null;
    const step = Math.floor(local / 0.1);
    if (step === 0) return { color: lighten(accent, 0.05, 0.08), alpha: 1 };
    if (step === 1) return { color: lighten(accent, 0.45, -0.1), alpha: 1 };
    return {
      color: lighten(accent, 0.45, -0.1),
      alpha: 1 - (local - 0.2) / 0.1,
    };
  })();
  const glow = (b.glow ?? 0) * glowEnvelope(local);
  // Sweep: a band crosses the accent words in 0.9 s, fast then slow.
  const sweepK = b.sweep && local < 0.9 ? sharp(local / 0.9) : null;

  let i = 0;
  rows.forEach((row, r) => {
    const left = leftOf(row);
    const cy = top + b.size * (r + 0.5);
    for (const w of row) {
      const a = alpha[i] ?? 1;
      i += 1;
      let text = w.word;
      if (typed !== Number.POSITIVE_INFINITY) {
        if (typed <= 0) return;
        text = Array.from(w.word).slice(0, typed).join("");
        typed -= Array.from(w.word).length + 1;
      }
      const wx = left + w.x;
      const wy = cy + (1 - a) * b.size * 0.35;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.font = fontOf(w.accent);
      ctx.textBaseline = "middle";
      if (b.tracking && "letterSpacing" in ctx)
        ctx.letterSpacing = `${b.tracking * px}px`;
      // Shadow first (under everything), hard and bottom-right.
      if (b.shadow) {
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${0.6 * b.shadow})`;
        ctx.shadowBlur = px * 0.06;
        ctx.shadowOffsetX = px * 0.03;
        ctx.shadowOffsetY = px * 0.045;
        ctx.fillStyle = "rgba(0, 0, 0, 1)";
        ctx.fillText(text, wx, wy);
        ctx.restore();
      }
      // Glow: a blurred copy added under the ink.
      if (glow > 0 && (w.accent || !b.accent)) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha *= Math.min(1, glow * 2.2);
        ctx.shadowColor = w.accent ? lighten(accent, 0.3) : "#ffffff";
        ctx.shadowBlur = px * 0.6;
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.strokeStyle = "rgba(0, 0, 0, 0)";
        // Only the shadow is wanted: draw the glyph transparent, offset far
        // away, with the shadow offset back onto the word.
        ctx.shadowOffsetX = 4000;
        ctx.fillStyle = "#000";
        ctx.fillText(text, wx - 4000, wy);
        ctx.restore();
      }
      // Ink: a soft vertical gradient on base words, a light horizontal
      // gradient on accent words (never a saturated flat colour).
      if (w.accent) {
        const g = ctx.createLinearGradient(wx, 0, wx + w.w, 0);
        g.addColorStop(0, lighten(accent, 0.3, -0.03));
        g.addColorStop(1, lighten(accent, 0.45, 0.05));
        ctx.fillStyle = g;
      } else {
        // White -> slightly darker at the bottom of the block (a faked lighting).
        const [h, sat, l] = hexToHsl(b.color);
        const g = ctx.createLinearGradient(0, top, 0, top + height);
        g.addColorStop(0, b.color);
        g.addColorStop(1, hslToHex(h, sat, l * 0.86));
        ctx.fillStyle = g;
      }
      ctx.fillText(text, wx, wy);
      if (w.accent && flashColor) {
        ctx.save();
        ctx.globalAlpha *= Math.max(0, flashColor.alpha);
        ctx.fillStyle = flashColor.color;
        ctx.fillText(text, wx, wy);
        ctx.restore();
      }
      if (w.accent && sweepK !== null) {
        const band = w.w * 0.35;
        const bx = wx - band + (w.w + band * 2) * sweepK;
        const g = ctx.createLinearGradient(bx - band / 2, 0, bx + band / 2, 0);
        g.addColorStop(0, "rgba(255, 255, 255, 0)");
        g.addColorStop(0.5, "rgba(255, 255, 255, 0.55)");
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = g;
        ctx.fillText(text, wx, wy);
        ctx.restore();
      }
      ctx.restore();
    }
  });
}

/** Draws a text block with its reveal (typewriter, words or wipe). */
function drawText(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  m: Motion,
  mode: "typewriter" | "words" | "wipe" | null,
) {
  let b = block;
  if (hasEmphasis(b)) {
    drawEmphasisText(ctx, b, m, mode);
    return;
  }
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
  fillBackground(ctx, slide.background, out.width, out.height, local);
  const push = slide.push ?? 1;
  if (push > 1 && slide.duration > 0) {
    // A slow push-in over the card, decelerating, about its centre.
    const k = Math.max(0, Math.min(1, local / slide.duration));
    const e = k * (2 - k);
    const z = 1 + (push - 1) * e;
    ctx.translate(out.width / 2, out.height / 2);
    ctx.scale(z, z);
    ctx.translate(-out.width / 2, -out.height / 2);
  }
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

/**
 * A picture layer; floating ones (popped out of a screen) carry a soft
 * drop shadow below and a thin glow of the accent along their edge.
 */
function drawMedia(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource | null,
  r: DOMRectLike,
  radius: number,
  look: FloatLook = {},
  short = Math.min(r.width, r.height),
) {
  const shadow = look.shadow ?? 0;
  if (shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${(0.55 * shadow).toFixed(3)})`;
    ctx.shadowBlur = 0.06 * short * shadow * 2;
    ctx.shadowOffsetY = 0.018 * short * shadow * 2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, radius);
  if (!image) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fill();
  } else {
    ctx.save();
    ctx.clip();
    ctx.drawImage(image, r.x, r.y, r.width, r.height);
    ctx.restore();
  }
  if (look.glow) {
    // A hairline of light on the edge and a faint halo around it.
    const w = Math.max(1, short * 0.0025);
    ctx.save();
    ctx.lineWidth = w;
    ctx.strokeStyle = hexAlphaOf(look.glow, 0.85);
    ctx.shadowColor = hexAlphaOf(look.glow, 0.7);
    ctx.shadowBlur = short * 0.02;
    ctx.beginPath();
    ctx.roundRect(r.x + w / 2, r.y + w / 2, r.width - w, r.height - w, Math.max(0, radius - w / 2));
    ctx.stroke();
    ctx.restore();
  }
}

function hexAlphaOf(hex: string, alpha: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
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
    else if (o.kind === "text" && o.words?.length)
      drawCaption(ctx, o, o.words, t - o.start, r, out);
    else if (o.kind === "text" && o.animator)
      drawAnimatedText(ctx, o, o.animator, t - o.start, r, out);
    else if (o.kind === "text") drawTextOverlay(ctx, o, m, r, out, t - o.start);
    else if (o.kind === "shape") drawShape(ctx, o, m, r, out);
    else
      drawMedia(
        ctx,
        mediaOf(o),
        r,
        o.radius * short,
        { shadow: o.shadow, glow: o.glow },
        short,
      );
    ctx.restore();
  }
}

function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  o: TextOverlay,
  m: Motion,
  r: DOMRectLike,
  out: Size,
  local: number,
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
      accent: o.style.accent,
      flash: o.style.flash,
      glow: o.style.glow,
      shadow: o.style.shadow,
      sweep: o.style.sweep,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: r.width,
      local,
    },
    m,
    mode,
  );
}

/**
 * Word-timed caption: the group's words laid out once (centred lines, so
 * nothing shifts), each fading in as it is spoken; the word being said is
 * in the accent colour and pops on a sharp curve; the group fades out.
 */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  o: TextOverlay,
  words: CaptionWord[],
  local: number,
  r: DOMRectLike,
  out: Size,
) {
  const size = o.style.size * out.height;
  const px = size * 0.8;
  ctx.font = `${o.style.weight} ${px}px ${o.style.font}, -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const space = ctx.measureText(" ").width;
  // Lines of words that fit the box; a word never splits.
  const lines: { i: number; w: number }[][] = [[]];
  let used = 0;
  words.forEach((word, i) => {
    const w = ctx.measureText(word.text).width;
    const line = lines[lines.length - 1];
    if (line.length > 0 && used + space + w > r.width) {
      lines.push([{ i, w }]);
      used = w;
    } else {
      line.push({ i, w });
      used += (line.length > 1 ? space : 0) + w;
    }
  });
  const states = captionStateAt(words, local, o.duration);
  const top = r.y + r.height / 2 - (lines.length * size) / 2;
  const cx = r.x + r.width / 2;
  lines.forEach((line, row) => {
    const width = line.reduce((s, u, k) => s + u.w + (k ? space : 0), 0);
    let x = cx - width / 2;
    const y = top + size * (row + 0.5);
    for (const u of line) {
      const s = states[u.i];
      if (s && s.opacity > 0.001) {
        ctx.save();
        ctx.globalAlpha *= s.opacity;
        ctx.translate(x + u.w / 2, y);
        if (s.scale !== 1) ctx.scale(s.scale, s.scale);
        const text = words[u.i].text;
        if (o.style.shadow) {
          ctx.fillStyle = `rgba(0, 0, 0, ${(o.style.shadow * 0.9).toFixed(3)})`;
          ctx.fillText(text, -u.w / 2 + px * 0.04, px * 0.05);
        }
        ctx.fillStyle =
          s.active && o.style.accent ? o.style.accent : o.style.color;
        ctx.fillText(text, -u.w / 2, 0);
        ctx.restore();
      }
      x += u.w + space;
    }
  });
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
  // *Words between stars* are drawn in the accent colour, stars dropped.
  const { plain, accented } = stripStars(o.text, Boolean(o.style.accent));
  const lines = wrapLines(ctx, plain, r.width);
  let scan = 0;
  const lineStart = lines.map((l) => {
    const at = Math.max(0, plain.indexOf(l, scan));
    scan = at + l.length;
    return at;
  });
  const isAccent = (line: number, at: number, len: number) =>
    accented.slice(lineStart[line] + at, lineStart[line] + at + len).some(Boolean);
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
  const placed: {
    text: string;
    x: number;
    y: number;
    w: number;
    accent: boolean;
  }[] = [];
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
        accent: isAccent(u.line, 0, line.length),
      });
      continue;
    }
    // Find the unit in its line after the previous one (spaces are skipped).
    const at = line.indexOf(u.text, cursor[u.line]);
    cursor[u.line] = at + u.text.length;
    const x = lineLeft(line) + ctx.measureText(line.slice(0, at)).width;
    placed.push({
      text: u.text,
      x,
      y,
      w: ctx.measureText(u.text).width,
      accent: isAccent(u.line, at, u.text.length),
    });
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
    if (p.accent && o.style.accent) ctx.fillStyle = o.style.accent;
    ctx.fillText(p.text, -p.w / 2, 0);
    ctx.restore();
  });
}

/**
 * Drops the stars of `*accent*` spans and says, per remaining character,
 * whether it sits in one. Without an accent colour the stars are kept as
 * written.
 */
function stripStars(
  text: string,
  enabled: boolean,
): { plain: string; accented: boolean[] } {
  if (!enabled || !/\*[^*]+\*/.test(text))
    return { plain: text, accented: Array(text.length).fill(false) };
  let plain = "";
  const accented: boolean[] = [];
  let inside = false;
  for (const ch of text) {
    if (ch === "*") {
      inside = !inside;
      continue;
    }
    plain += ch;
    accented.push(inside);
  }
  return { plain, accented };
}
