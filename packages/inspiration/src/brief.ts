import type { Direction, Technique } from "./direction";
import type { Inspiration } from "./search";

// A direction turned into a working brief for goScreen: what to keep, and with
// which of the studio's own tools each technique is done. Read by the AI before
// it builds a film, and shown to the person next to the original prompt.

export const GOSCREEN_TOOLS: Record<Technique, string | null> = {
  "beat-sync":
    "Put a music clip under the film (edit.addMedia) and land cuts, cards and block entrances on its beats.",
  "continuous-take":
    "Chain clips with short transitions and let each block start where the last one ends; avoid hard cuts between scenes.",
  cursor:
    "Keep the synthetic cursor on (Cursor & clicks): it lands exactly on each recorded click.",
  "camera-zoom":
    "Zoom on bursts of clicks (Auto zoom on clicks, film zoom) so each moment fills the frame.",
  "mask-reveal":
    "Text animations Lines slide / Words rise (animation.presets) reveal type line by line.",
  "kinetic-type":
    "Text animators (letter, word or line units) and the kinetic-title block.",
  springs:
    'Ease "spring" on keyframes, or the Words spring / Letters pop presets.',
  "motion-blur": null,
  captions:
    "Film captions (top or bottom) on every scene; highlight block for one key phrase.",
  "voice-over": "Record a voice-over on an audio track, then Trim silent ends.",
  counter: "stat-counter block (edit.addBlock).",
  chart: "bar-chart block (edit.addBlock).",
  device:
    "Showcase look: the real device frame around the take (film look showcase).",
  loop: "End on the same frame as the opening card so the export loops.",
  grain: null,
  "sound-design":
    "Tap sounds on clicks, plus a music clip; sound effects as audio clips.",
  "3d": null,
  particles: null,
};

const fmt = (d: Direction) =>
  [
    d.aspect && `format ${d.aspect}`,
    d.size && `${d.size.width}×${d.size.height}`,
    d.duration && `${d.duration} s`,
    d.fps && `${d.fps} fps`,
    d.bpm && `${d.bpm} BPM`,
  ]
    .filter(Boolean)
    .join(" · ");

/** Markdown: credit, direction, how to do it here, then the prompt itself. */
export function briefOf(i: Inspiration): string {
  const d = i.direction;
  const lines = [
    `# Inspiration: @${i.author} (${i.category})`,
    `Original post: ${i.post_url || "unknown"}. Credit the creator when the film is shared.`,
    i.prompt_partial
      ? "Only part of the prompt was shared: treat it as a description of the result."
      : "",
    "",
    "## Direction",
    fmt(d) || "No format given: keep the film's own.",
  ];
  if (d.palette.length)
    lines.push(
      `Palette: ${d.palette.map((s) => (s.role ? `${s.hex} (${s.role})` : s.hex)).join(", ")}`,
    );
  if (d.fonts.length) lines.push(`Type: ${d.fonts.join(", ")}`);
  if (d.genres.length) lines.push(`Genre: ${d.genres.join(", ")}`);
  if (d.banned.length) lines.push(`Banned: ${d.banned.join("; ")}`);
  if (d.structure.length)
    lines.push("", "## Structure", ...d.structure.map((s) => `- ${s}`));
  const doable = d.techniques.filter((t) => GOSCREEN_TOOLS[t]);
  const missing = d.techniques.filter((t) => !GOSCREEN_TOOLS[t]);
  if (doable.length)
    lines.push(
      "",
      "## In goScreen",
      ...doable.map((t) => `- ${t}: ${GOSCREEN_TOOLS[t]}`),
    );
  if (missing.length)
    lines.push(
      "",
      `Not available in goScreen (leave out, never fake): ${missing.join(", ")}.`,
    );
  lines.push("", "## Prompt", "", i.prompt);
  return lines.filter((l, n, all) => l !== "" || all[n - 1] !== "").join("\n");
}
