export {
  alignToPayoff,
  PLAN_SLACK,
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
export {
  RENDER_PEAK,
  renderMusic,
  SAMPLE_RATE,
  SECTION_MIX,
} from "./render.ts";
export {
  renderSfx,
  SFX_KINDS,
  SFX_LEAD,
  SFX_LENGTHS,
  SFX_LEVELS,
  SFX_PEAK,
  SFX_PER_MINUTE,
  type SfxKind,
  sfxKindSchema,
  type SfxLevel,
  sfxLevelSchema,
  sfxBudget,
  SOUND_DENSITIES,
  type SoundDensity,
  soundDensitySchema,
} from "./sfx.ts";
export {
  MOTION_KINDS,
  type MotionEvent,
  type MotionKind,
  SFX_MIN_GAP,
  type SoundCue,
  soundDesign,
  thin,
} from "./soundDesign.ts";
export {
  type Beat,
  type BedPlacement,
  beatGrid,
  nearestBeat,
} from "./beats.ts";
export {
  MUSIC_STYLES,
  type MusicStyle,
  musicStyleSchema,
  pickStyle,
  STYLE_SPECS,
  type StyleSpec,
} from "./styles.ts";
export { encodeWav } from "./wav.ts";
