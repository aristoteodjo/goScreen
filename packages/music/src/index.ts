export {
  alignToPayoff,
  type MusicPlan,
  musicPlan,
  musicPlanSchema,
  SECTION_KINDS,
  type Section,
  type SectionKind,
  sectionAt,
  sectionsFor,
  seeded,
  triad,
} from "./plan.ts";
export { RENDER_PEAK, renderMusic, SAMPLE_RATE, SECTION_MIX } from "./render.ts";
export {
  MAX_SFX,
  renderSfx,
  SFX_KINDS,
  SFX_LENGTHS,
  type SfxKind,
  sfxKindSchema,
} from "./sfx.ts";
export {
  MUSIC_STYLES,
  type MusicStyle,
  musicStyleSchema,
  pickStyle,
  STYLE_SPECS,
  type StyleSpec,
} from "./styles.ts";
export { encodeWav } from "./wav.ts";
