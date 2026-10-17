import type { Direction, Swatch } from "./direction";

// From a direction to the film's settings (format, colours, font): only what
// the prompt actually says, so a direction never resets what it is silent on.

export type FilmPatch = {
  aspect?: "16:9" | "9:16" | "1:1" | "4:5";
  background?: string;
  ink?: string;
  accent?: string;
  font?: string;
};

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function chroma(hex: string): number {
  const c = rgb(hex);
  return (Math.max(...c) - Math.min(...c)) / 255;
}

/**
 * Background, text and accent from a prompt's palette. Colours the prompt
 * names for a role keep it; the others are deduced: the background is the
 * first colour given (prompts open on the canvas), the text the colour that
 * reads best on it, the accent the most saturated of what is left.
 */
export function rolesOf(palette: Swatch[]): {
  background?: string;
  ink?: string;
  accent?: string;
} {
  if (palette.length === 0) return {};
  const named = (role: Swatch["role"]) =>
    palette.find((s) => s.role === role)?.hex;
  const background = named("background") ?? palette[0].hex;
  const rest = palette.map((s) => s.hex).filter((h) => h !== background);
  const ink =
    named("ink") ??
    [...rest]
      .filter((h) => contrast(h, background) >= 4.5)
      .sort((a, b) => contrast(b, background) - contrast(a, background))[0];
  const accent =
    named("accent") ??
    [...rest]
      .filter((h) => h !== ink && chroma(h) > 0.25)
      .sort((a, b) => chroma(b) - chroma(a))[0];
  return { background, ink, accent };
}

/** The closest of the fonts the studio can draw. */
export function closestFont(
  named: string[],
  available: string[],
): string | undefined {
  const has = (f: string) =>
    available.find((a) => a.toLowerCase().startsWith(f.toLowerCase()));
  for (const f of named) {
    const exact = has(f);
    if (exact) return exact;
  }
  const first = named[0]?.toLowerCase();
  if (!first) return undefined;
  if (/mono/.test(first)) return has("Menlo");
  if (/serif|playfair|georgia/.test(first)) return has("Georgia");
  if (/grotesk|grotesque|syne|archivo/.test(first))
    return has("Bricolage Grotesque") ?? has("Inter");
  return has("Inter") ?? has("Helvetica Neue");
}

export function filmPatch(d: Direction, fonts: string[]): FilmPatch {
  const patch: FilmPatch = { ...rolesOf(d.palette) };
  // 4:3 is not a film format: the nearest one keeps the composition.
  if (d.aspect) patch.aspect = d.aspect === "4:3" ? "16:9" : d.aspect;
  const font = closestFont(d.fonts, fonts);
  if (font) patch.font = font;
  for (const k of Object.keys(patch) as (keyof FilmPatch)[])
    if (patch[k] === undefined) delete patch[k];
  return patch;
}
