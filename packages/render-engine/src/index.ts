export { AUTO_SCALE, buildAutoZooms } from "./autoZoom";
export {
  activeZoom,
  applyCamera,
  autoFocus,
  cameraAt,
  easeInOut,
  ZOOM_RAMP,
  zoomAmount,
} from "./camera";
export {
  composeFrame,
  type GeometryOf,
  type Timeline,
  timelineOf,
} from "./compose";
export { type CursorMark, cursorAt } from "./cursor";
export { type Quad, quadMapper } from "./homography";
export {
  arrangeLayers,
  hitLayer,
  layerPoint,
  nearestCorner,
  placeLayer,
  rectAt,
  stageArea,
  webcamRect,
} from "./layers";
export {
  type Extrapolate,
  type InterpolateOptions,
  interpolate,
  SPRING_DEFAULT,
  type SpringConfig,
  spring,
  springSettle,
} from "./keyframes";
export { ASPECT_OPTIONS, contentRect, fitInto, outputSize } from "./layout";
export {
  activeOverlays,
  animate,
  type Motion,
  motionAt,
  overlayMotion,
  STILL,
  slideMotion,
  typedText,
  wordOpacities,
} from "./motion";
export {
  type Chapter,
  DEFAULT_EDIT,
  EMPTY_RECORDING,
  fullClip,
  parseEditState,
  parseRecordingFile,
  type RecordingFile,
} from "./schema";
export {
  clampToSource,
  clipAt,
  clipDuration,
  clipsWithout,
  dropIndex,
  MIN_CLIP,
  moveClip,
  type Pause,
  type Placed,
  placeClips,
  recordingSpans,
  removeClip,
  SOURCE_END,
  SPEEDS,
  sequenceDuration,
  setSpeed,
  sourceTimeAt,
  splitAt,
  timelineTimesOf,
  trimClip,
} from "./sequence";
export {
  type AudioPiece,
  type AudioSource,
  audioPieces,
  MIC_ASSET,
} from "./soundtrack";
export {
  constrainSegment,
  formatTime,
  freeGap,
  MIN_SEGMENT,
  placeZoom,
  rulerStep,
} from "./timeline";
export { type Press, presses, RELEASE, tapTimes, touchesAt } from "./touches";
export {
  type ActiveTransition,
  DEFAULT_TRANSITION,
  TRANSITION_KINDS,
  type TransitionMix,
  transitionAt,
  transitionLength,
  transitionMix,
} from "./transitions";
export type * from "./types";
