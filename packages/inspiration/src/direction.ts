// A prompt read as a creative direction: what a motion designer would note
// before starting (format, length, tempo, palette, type, what is banned, how
// the film is built). Plain pattern matching, no AI: the same prompt always
// gives the same direction, and anything not found stays null or empty.

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5", "4:3"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const TECHNIQUES = [
  "beat-sync",
  "continuous-take",
  "cursor",
  "camera-zoom",
  "mask-reveal",
  "kinetic-type",
  "springs",
  "motion-blur",
  "captions",
  "voice-over",
  "counter",
  "chart",
  "device",
  "loop",
  "grain",
  "sound-design",
  "3d",
  "particles",
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export const GENRES = [
  "launch",
  "ad",
  "explainer",
  "demo",
  "kinetic-type",
  "brand",
  "data",
  "game",
  "art",
] as const;
export type Genre = (typeof GENRES)[number];

export type ColorRole = "background" | "ink" | "accent";
export type Swatch = { hex: string; role: ColorRole | null };

export type Direction = {
  aspect: Aspect | null;
  size: { width: number; height: number } | null;
  /** Seconds. */
  duration: number | null;
  fps: number | null;
  bpm: number | null;
  palette: Swatch[];
  fonts: string[];
  banned: string[];
  techniques: Technique[];
  genres: Genre[];
  /** The scenes or beats the prompt lays out, in order. */
  structure: string[];
};

const TECHNIQUE_PATTERNS: Record<Technique, RegExp> = {
  "beat-sync": /\bbpm\b|every (major )?beat|on the beat|beat grid|the drop\b/,
  "continuous-take":
    /continuous take|no (scene )?cuts|nothing (ever )?cuts|grows? (out of|from) the (last|previous|one before)|made out of the previous/,
  cursor: /\bcursor\b|mouse pointer|macos pointer/,
  "camera-zoom":
    /camera zoom|screen[- ]studio|camera (pulls|pushes|glides|reframes)|push(es)? (slowly )?into/,
  "mask-reveal": /mask (line|wipe)|rises? (out of|from) a mask|iris/,
  "kinetic-type":
    /kinetic|typograph|letter by letter|word by word|letters? (bend|scramble|pop)/,
  springs: /\bsprings?\b|overshoot/,
  "motion-blur": /motion blur|sub-?frames?|\btmix\b/,
  captions: /captions?|subtitles?/,
  "voice-over": /voice ?-?over|narrat(or|ion)|voiceover|spoken line/,
  counter: /\bcounter\b|counts? (up|to)|ticks? up|rolling numerals/,
  chart: /\bcharts?\b|\bgraph\b|bar chart|sparkline/,
  device: /iphone|\bphones?\b|mockup|macbook|bezel|lock screen|dynamic island/,
  loop: /\bloop(s|able|ing)?\b/,
  grain: /film grain|\bgrain\b|vignette|halation/,
  "sound-design": /sound design|sound effects|\bsfx\b|whoosh|soundtrack/,
  "3d": /three\.?js|\b3d\b|webgl/,
  particles: /particles?/,
};

const GENRE_PATTERNS: Record<Genre, RegExp> = {
  launch: /launch|product film|showreel|keynote|reveal/,
  ad: /\bads?\b|commercial|promo|direct-response|hook/,
  explainer:
    /explainer|explain|tutorial|how (it|they|this) works|\bproof\b|lesson/,
  demo: /\bdemo\b|walkthrough|feature tour|ui states?|interface|dashboard|\bapp\b/,
  "kinetic-type": /kinetic|typograph|spoken[- ]word|\bquote\b|speech/,
  brand: /brand film|identity|bumper|logo|wordmark/,
  data: /\bcharts?\b|\bdata\b|infographic|statistic/,
  game: /\bgames?\b|playable|arcade/,
  art: /generative|shader|abstract|particles?|fractal/,
};

// Faces named in the prompts, longest first so "Archivo Black" wins over "Archivo".
const FONTS = [
  "Archivo Black",
  "IBM Plex Mono",
  "JetBrains Mono",
  "Instrument Serif",
  "Playfair Display",
  "Space Grotesk",
  "Space Mono",
  "Bricolage Grotesque",
  "SF Pro",
  "Helvetica Neue",
  "DM Sans",
  "Geist Mono",
  "Geist",
  "Inter",
  "Archivo",
  "Syne",
  "Manrope",
  "Poppins",
  "Montserrat",
  "Almarai",
  "Helvetica",
  "Futura",
  "Georgia",
  "Roboto",
];

const ROLE_WORDS: [ColorRole, RegExp][] = [
  ["background", /\b(background|bg|canvas|stage|backdrop|paper)\b/],
  ["ink", /\b(text|type|ink|typography|letterforms|primary type|ui)\b/],
  ["accent", /\b(accent|emphasis|highlight|brand|cta|button)\b/],
];

const unique = <T>(xs: T[]) => [...new Set(xs)];

function aspectOf(width: number, height: number): Aspect | null {
  const r = width / height;
  const near = (x: number) => Math.abs(r - x) < 0.02;
  if (near(16 / 9)) return "16:9";
  if (near(9 / 16)) return "9:16";
  if (near(1)) return "1:1";
  if (near(4 / 5)) return "4:5";
  if (near(4 / 3)) return "4:3";
  return null;
}

function sizeOf(text: string) {
  const m = /\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/.exec(text);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width >= 240 && height >= 240 ? { width, height } : null;
}

function durationOf(text: string): number | null {
  // "a 15-second film", "exactly 20.00 seconds", "~55s", "around 15 seconds".
  const patterns = [
    /(\d+(?:\.\d+)?)\s*-?\s*(?:seconds?|secs?)\b/g,
    /[~≈]\s*(\d+(?:\.\d+)?)\s*s\b/g,
    /\b(\d+(?:\.\d+)?)s (?:film|video|loop|spot|ad|teaser|bumper|reel)\b/g,
  ];
  let best: { at: number; value: number } | null = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const value = Number(m[1]);
      // Morphs and holds are measured in fractions of a second: not the film.
      if (value < 5 || value > 600) continue;
      if (!best || m.index < best.at) best = { at: m.index, value };
    }
  }
  return best?.value ?? null;
}

function numberBefore(text: string, unit: RegExp, min: number, max: number) {
  for (const m of text.matchAll(unit)) {
    const value = Number(m[1]);
    if (value >= min && value <= max) return value;
  }
  return null;
}

function paletteOf(text: string): Swatch[] {
  const out: Swatch[] = [];
  for (const m of text.matchAll(/#\s?([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (out.some((s) => s.hex === hex)) continue;
    // The words just before a colour say what it is for ("bg #0A0A0A").
    const before = text.slice(Math.max(0, m.index - 48), m.index).toLowerCase();
    const line = before.split(/[\n;]/).pop() ?? "";
    let role: ColorRole | null = null;
    let at = -1;
    for (const [r, re] of ROLE_WORDS) {
      for (const w of line.matchAll(new RegExp(re, "g")))
        if (w.index > at) {
          at = w.index;
          role = r;
        }
    }
    out.push({ hex, role });
  }
  return out.slice(0, 12);
}

function fontsOf(text: string): string[] {
  const found: string[] = [];
  let rest = text;
  for (const f of FONTS) {
    const re = new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(rest)) {
      found.push(f);
      rest = rest.replace(new RegExp(re, "gi"), " ");
    }
  }
  return found;
}

function bannedOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /^\s*(?:banned|avoid|do not use)\s*:\s*(.+)$/gim,
  )) {
    for (const part of m[1].split(/,|;|\.\s/)) {
      const item = part.replace(/\.$/, "").trim();
      if (item.length > 1 && item.length < 80) out.push(item);
    }
  }
  return unique(out).slice(0, 24);
}

function structureOf(text: string): string[] {
  const tagged = /<(structure|storyboard)>([\s\S]*?)(?:<\/\1>|$)/i.exec(text);
  const headed =
    /^\s*(?:storyboard|structure|narrative arc|beats?)\b[^\n]*\n([\s\S]*?)(?:\n\s*\n[A-Z <]{4}|\n<|$)/im.exec(
      text,
    );
  const body = tagged?.[2] ?? headed?.[1] ?? "";
  return body
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2)
    .map((l) => (l.length > 240 ? `${l.slice(0, 237)}…` : l))
    .slice(0, 24);
}

export function directionOf(prompt: string): Direction {
  const lower = prompt.toLowerCase();
  const size = sizeOf(prompt);
  const explicit = /\b(16:9|9:16|1:1|4:5|4:3)\b/.exec(prompt)?.[1] as
    | Aspect
    | undefined;
  const aspect =
    explicit ??
    (size ? aspectOf(size.width, size.height) : null) ??
    (/\bsquare\b/.test(lower)
      ? "1:1"
      : /\bvertical\b|\breels?\b|tiktok/.test(lower)
        ? "9:16"
        : null);
  return {
    aspect,
    size,
    duration: durationOf(lower),
    fps: numberBefore(lower, /(\d{2,3})\s*fps\b/g, 12, 120),
    bpm: numberBefore(lower, /(\d{2,3})\s*bpm\b/g, 50, 200),
    palette: paletteOf(prompt),
    fonts: fontsOf(prompt),
    banned: bannedOf(prompt),
    techniques: TECHNIQUES.filter((t) => TECHNIQUE_PATTERNS[t].test(lower)),
    genres: GENRES.filter((g) => GENRE_PATTERNS[g].test(lower)),
    structure: structureOf(prompt),
  };
}
