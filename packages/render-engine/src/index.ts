export { buildAutoZooms } from "./autoZoom";
export { activeZoom, applyCamera, autoFocus, cameraAt, easeInOut, ZOOM_RAMP, zoomAmount } from "./camera";
export { composeFrame, type GeometryOf, type Timeline, timelineOf } from "./compose";
export { type Quad, quadMapper } from "./homography";
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
export { arrangeLayers, hitLayer, layerPoint, nearestCorner, placeLayer, rectAt, stageArea, webcamRect } from "./layers";
export { ASPECT_OPTIONS, contentRect, fitInto, outputSize } from "./layout";
export { DEFAULT_EDIT, EMPTY_RECORDING, fullClip, parseEditState, parseRecordingFile, type RecordingFile } from "./schema";
export {
  clampToSource,
  clipAt,
  clipDuration,
  dropIndex,
  MIN_CLIP,
  moveClip,
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
export { constrainSegment, formatTime, freeGap, MIN_SEGMENT, placeZoom, rulerStep } from "./timeline";
export { type AudioPiece, type AudioSource, audioPieces } from "./soundtrack";
export { type Press, presses, RELEASE, tapTimes, touchesAt } from "./touches";
export type * from "./types";
