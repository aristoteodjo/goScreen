/** Brand colors come as any CSS color; the edit schema wants `#rrggbb`. */
export function toHex(css: string | null | undefined): string | null {
  if (!css) return null;
  const v = css.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3,8})$/)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4)
      return `#${[...hex.slice(0, 3)].map((c) => c + c).join("")}`;
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return null;
  }
  const nums = (s: string) =>
    s
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((n) => Number.parseFloat(n));
  const rgb = v.match(/^rgba?\((.+)\)$/)?.[1];
  if (rgb) {
    const [r, g, b] = nums(rgb);
    return rgbHex(r, g, b);
  }
  const hsl = v.match(/^hsla?\((.+)\)$/)?.[1];
  if (hsl) {
    const [h, s, l] = nums(hsl);
    return hslHex(h, s / 100, l / 100);
  }
  return null;
}

function rgbHex(r: number, g: number, b: number): string | null {
  if (![r, g, b].every(Number.isFinite)) return null;
  const c = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hslHex(h: number, s: number, l: number): string | null {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return rgbHex(f(0), f(8), f(4));
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG), 0 = black, 1 = white. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mixes toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const [r, g, b] = channels(hex).map((c) => c + (target - c) * t);
  return rgbHex(r, g, b) ?? hex;
}

/** Ink or white, whichever reads best on `bg`. */
export function readableOn(bg: string, ink = "#111111"): string {
  const contrast = (a: number, b: number) =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const l = luminance(bg);
  return contrast(l, luminance(ink)) >= contrast(l, 1) ? ink : "#ffffff";
}
