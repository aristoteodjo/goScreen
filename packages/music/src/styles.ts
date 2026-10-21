// Six beds, each a mood rather than a song: what a campaign's tone or a
// film's genre asks for. Everything a style decides is written here, so a
// plan built from it is the same on every machine.

import { z } from "zod";

export const MUSIC_STYLES = [
  "calm",
  "warm",
  "pulse",
  "rise",
  "focus",
  "bright",
] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];
export const musicStyleSchema = z.enum(MUSIC_STYLES);

export type StyleSpec = {
  label: string;
  // Beats per minute.
  tempo: number;
  // MIDI roots the seed chooses from.
  roots: number[];
  mode: "major" | "minor";
  // Chord progressions as scale degrees (0 = the root), one chord a bar.
  progressions: number[][];
  // Low-pass cutoff as a fraction of the sample rate's half (0..1): the
  // darker the bed, the lower.
  brightness: number;
  // How much the beat pushes the pad down (0 = no sidechain).
  drive: number;
  // Arpeggio notes per beat (0 = none).
  arp: number;
  // A soft kick on every beat in the full section.
  kick: boolean;
};

export const STYLE_SPECS: Record<MusicStyle, StyleSpec> = {
  calm: {
    label: "Calm",
    tempo: 72,
    roots: [57, 60, 62],
    mode: "major",
    progressions: [
      [0, 3, 5, 4],
      [0, 5, 3, 4],
    ],
    brightness: 0.12,
    drive: 0.1,
    arp: 0,
    kick: false,
  },
  warm: {
    label: "Warm",
    tempo: 84,
    roots: [53, 55, 58],
    mode: "major",
    progressions: [
      [0, 5, 3, 4],
      [3, 4, 0, 5],
    ],
    brightness: 0.18,
    drive: 0.25,
    arp: 1,
    kick: false,
  },
  pulse: {
    label: "Pulse",
    tempo: 118,
    roots: [45, 48, 50],
    mode: "minor",
    progressions: [
      [0, 5, 2, 6],
      [0, 6, 2, 5],
    ],
    brightness: 0.3,
    drive: 0.55,
    arp: 2,
    kick: true,
  },
  rise: {
    label: "Rise",
    tempo: 104,
    roots: [50, 52, 55],
    mode: "major",
    progressions: [
      [0, 4, 5, 3],
      [5, 3, 0, 4],
    ],
    brightness: 0.26,
    drive: 0.4,
    arp: 2,
    kick: true,
  },
  focus: {
    label: "Focus",
    tempo: 96,
    roots: [48, 50, 53],
    mode: "minor",
    progressions: [
      [0, 2, 5, 6],
      [0, 5, 6, 2],
    ],
    brightness: 0.2,
    drive: 0.35,
    arp: 2,
    kick: false,
  },
  bright: {
    label: "Bright",
    tempo: 124,
    roots: [55, 57, 60],
    mode: "major",
    progressions: [
      [0, 4, 5, 3],
      [0, 3, 4, 4],
    ],
    brightness: 0.4,
    drive: 0.5,
    arp: 4,
    kick: true,
  },
};

const TONES: [RegExp, MusicStyle][] = [
  [/calm|soft|quiet|serene|gentle|minimal|elegant/, "calm"],
  [/warm|friendly|human|cosy|cozy|caring|reassur/, "warm"],
  [/energetic|bold|punchy|dynamic|urgent|fast|hype/, "pulse"],
  [/epic|inspir|ambitious|visionary|grand|premium|luxury/, "rise"],
  [/serious|technical|professional|focused|corporate|expert|precise/, "focus"],
  [/playful|fun|cheerful|happy|joyful|light|upbeat/, "bright"],
];

const GENRES: [RegExp, MusicStyle][] = [
  [/teaser|video-ad|\bad\b|promo/, "pulse"],
  [/launch|awareness/, "rise"],
  [/explainer|demo|walkthrough|tutorial|onboarding|feature|integration/, "focus"],
  [/booth|corporate|case/, "calm"],
  [/testimonial|recruit|use-case|acquisition/, "warm"],
];

/**
 * The bed a campaign's tone (first) or a film's genre or objective (then)
 * calls for. Unknown words fall back to "focus", the one that fits a
 * product demo.
 */
export function pickStyle(tone?: string | null, genre?: string | null): MusicStyle {
  const t = (tone ?? "").toLowerCase();
  for (const [re, style] of TONES) if (re.test(t)) return style;
  const g = (genre ?? "").toLowerCase();
  for (const [re, style] of GENRES) if (re.test(g)) return style;
  return "focus";
}
