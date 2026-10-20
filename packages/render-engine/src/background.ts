// Cinematic backgrounds, after the course's three recipes: blurred discs of
// one hue family turning slowly ("rotating"), one soft asymmetric blob that
// breathes and smears from its centre ("blob"), and overlapping soft bands
// that drift ("waves"). Everything is a pure function of time; the drawing
// (blur, grain, vignette) is the shell's job.

export type MeshStyle = "circles" | "blob" | "waves";

export type MeshBackground = {
  kind: "mesh";
  style: MeshStyle;
  // The canvas colour under everything (a very dark navy rather than black).
  base: string;
  // The shapes' colours, one hue family, desaturated.
  colors: string[];
  // 1 = the course's pace (20°/s rotation, 0.5 wiggles/s, wave speed 0.1).
  speed: number;
  // Blur as a fraction of the output's short side (circles: ~0.14).
  blur: number;
  // Static grain and vignette strengths, 0..1.
  grain: number;
  vignette: number;
};

/** A disc or band of the mesh, in fractions of the output (centre, radii). */
export type MeshShape = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  // Extra blur for this shape (waves: the farther, the softer).
  soft: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function hexToHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  const sat = clamp(s, 0, 1);
  const lig = clamp(l, 0, 1);
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * A mesh palette from a brand colour: a very dark base of the same hue and
 * five desaturated tones from dark to light ("a torch in a dark room", never
 * the vivid corner of the picker).
 */
export function meshPalette(
  accent: string,
  mode: "dark" | "light" = "dark",
): { base: string; colors: string[] } {
  const [h, s] = hexToHsl(accent);
  const sat = clamp(s * 0.55, 0.18, 0.5);
  if (mode === "light") {
    return {
      base: hslToHex(h, 0.25, 0.97),
      colors: [0.86, 0.8, 0.9, 0.76, 0.88].map((l, i) =>
        hslToHex(h + (i - 2) * 0.03, sat, l),
      ),
    };
  }
  return {
    base: hslToHex(h, clamp(s * 0.6, 0.2, 0.5), 0.07),
    colors: [0.16, 0.24, 0.2, 0.32, 0.12].map((l, i) =>
      hslToHex(h + (i - 2) * 0.025, sat, l),
    ),
  };
}

/** Deterministic pseudo-random in 0..1 from a seed and an index. */
function rand(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The shapes of a style at rest (t = 0). Circles: nine discs covering a
 * frame twice as large as the output so that turning never shows a corner.
 * Blob: one tall, lopsided shape. Waves: three bands, the farthest softest.
 */
export function meshShapes(bg: MeshBackground, seed = 1): MeshShape[] {
  const colors = bg.colors.length ? bg.colors : ["#2a3a6a"];
  const color = (i: number) => colors[i % colors.length];
  if (bg.style === "circles") {
    const out: MeshShape[] = [];
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + rand(seed, i) * 0.6;
      const d = i === 0 ? 0 : 0.35 + rand(seed, i + 9) * 0.45;
      const r = 0.38 + rand(seed, i + 18) * 0.3;
      out.push({
        x: 0.5 + Math.cos(a) * d,
        y: 0.5 + Math.sin(a) * d,
        rx: r,
        ry: r,
        color: color(i),
        soft: 0,
      });
    }
    return out;
  }
  if (bg.style === "blob") {
    return [
      { x: 0.5, y: 0.58, rx: 0.3, ry: 0.42, color: color(0), soft: 0 },
      { x: 0.42, y: 0.5, rx: 0.16, ry: 0.22, color: color(1), soft: 0.4 },
    ];
  }
  return [
    { x: 0.5, y: 0.78, rx: 0.9, ry: 0.22, color: color(0), soft: 0 },
    { x: 0.5, y: 0.58, rx: 0.95, ry: 0.2, color: color(1), soft: 0.5 },
    { x: 0.5, y: 0.38, rx: 1, ry: 0.18, color: color(2), soft: 1 },
  ];
}

export type MeshFrame = {
  // Rotation of the whole mesh about the output's centre (radians).
  rotation: number;
  shapes: MeshShape[];
};

/**
 * The mesh at time t: circles turn at 20°/s × speed, the blob wiggles at
 * 0.5 Hz × speed by a tenth of its size, bands slide sideways at 0.1 × speed.
 */
export function meshAt(bg: MeshBackground, t: number, seed = 1): MeshFrame {
  const shapes = meshShapes(bg, seed);
  const s = bg.speed;
  if (bg.style === "circles") {
    return { rotation: ((20 * s * t) / 180) * Math.PI, shapes };
  }
  if (bg.style === "blob") {
    const w = (i: number, f: number) =>
      Math.sin(t * 2 * Math.PI * 0.5 * s * f + i * 1.7);
    return {
      rotation: 0,
      shapes: shapes.map((sh, i) => ({
        ...sh,
        x: sh.x + 0.03 * w(i, 0.8),
        y: sh.y + 0.025 * w(i + 3, 1),
        rx: sh.rx * (1 + 0.08 * w(i + 6, 0.6)),
        ry: sh.ry * (1 + 0.08 * w(i + 9, 0.7)),
      })),
    };
  }
  return {
    rotation: 0,
    shapes: shapes.map((sh, i) => ({
      ...sh,
      x: sh.x + 0.08 * Math.sin(t * 2 * Math.PI * 0.1 * s + i * 2.1),
      y: sh.y + 0.015 * Math.sin(t * 2 * Math.PI * 0.07 * s + i),
    })),
  };
}

/** The course's three looks, ready to pick; colours from `meshPalette`. */
export function meshPreset(
  style: MeshStyle,
  accent: string,
  mode: "dark" | "light" = "dark",
): MeshBackground {
  const { base, colors } = meshPalette(accent, mode);
  return {
    kind: "mesh",
    style,
    base,
    colors,
    speed: 1,
    // Fractions of the short side: the course's 150 px box blur at 1080p
    // for the discs is ~0.14, but discs must never show an edge, so more.
    blur: style === "circles" ? 0.32 : style === "blob" ? 0.12 : 0.2,
    grain: 0.06,
    vignette: style === "waves" ? 0.35 : 0.25,
  };
}
