export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export type PointerKind = "down" | "move" | "up";
export type SourceKind = "web" | "android";

// One pointer sample captured while recording. `t` is seconds from the first
// video frame; x and y are normalized to the captured region (0..1). u and v
// are the same point inside the device screen (0..1), when known.
export type RecordedPointer = {
  t: number;
  kind: PointerKind;
  x: number;
  y: number;
  u?: number;
  v?: number;
  instanceId: string;
  source: SourceKind;
};

/** Where a device screen sat in the captured video from time t on (normalized). */
export type LayerRect = Rect & { t: number };

// A device recorded as a layer: its raw screen is in the video, its frame is
// redrawn by the editor and can change after capture.
export type RecordedLayer = {
  instanceId: string;
  deviceId: string;
  colorId: string;
  orientation: "portrait" | "landscape";
  // CSS size of the screen as shown during capture (current orientation).
  screen: Size;
  source: SourceKind;
  rotation: number;
  rects: LayerRect[];
};

export type CaptureMode = "scene" | "canvas" | "device";

export type AspectId = "auto" | "16:9" | "1:1" | "4:3" | "9:16" | "3:4" | "4:5";

export type EditBackground =
  | { kind: "none" }
  | { kind: "color"; value: string }
  | { kind: "gradient"; from: string; to: string; angle: number };

// focus null follows the touches inside the segment; otherwise it is a
// point of the output frame (0..1).
export type ZoomSegment = {
  id: string;
  start: number;
  end: number;
  scale: number;
  focus: Point | null;
};

export type TouchStyle = "ring" | "solid" | "none";

// How one recorded device is presented. Position and scale are relative to
// the stage area (output minus the camera column in split layout).
export type LayerEdit = {
  instanceId: string;
  deviceId: string;
  colorId: string;
  frame: boolean;
  x: number;
  y: number;
  // Frame height as a fraction of the stage area height.
  scale: number;
  rotation: number;
  // Its track is switched off: not drawn, its touches neither.
  hidden: boolean;
};

export type CameraLayout = "overlay" | "split";
export type CameraShape = "rounded" | "circle" | "square";

export type CameraEdit = {
  visible: boolean;
  layout: CameraLayout;
  // 3x3 grid, 0 = top-left, 8 = bottom-right.
  corner: number;
  // Fraction of the output's short side.
  size: number;
  shape: CameraShape;
  mirror: boolean;
};

export type TransitionKind =
  | "fade"
  | "dip"
  | "slide-left"
  | "slide-up"
  | "zoom"
  | "wipe";

// How a clip comes in over the end of the one before it. It overlaps the
// start of the clip (the sequence keeps its length); the outgoing side is
// the last frame of the previous clip.
export type Transition = { kind: TransitionKind; duration: number };

// A stretch of the screen recording on the main track, in source seconds.
// Camera, mic, zooms and touches follow it: they live in source time.
export type RecordingClip = {
  id: string;
  kind: "recording";
  in: number;
  out: number;
  speed: number;
  muted: boolean;
  cameraHidden: boolean;
  transition: Transition | null;
};

/** Enter / exit motion of a text, an overlay or a slide. */
export type Animation =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-left"
  | "pop"
  | "spring"
  | "typewriter"
  | "words"
  | "wipe";

// A full-frame title card on the main track, in place of the recording.
export type SlideClip = {
  id: string;
  kind: "slide";
  duration: number;
  background: EditBackground;
  title: string;
  subtitle: string;
  color: string;
  font: string;
  animation: Animation;
  transition: Transition | null;
};

export type MainClip = RecordingClip | SlideClip;

// Overlays sit on lanes above the video, free in timeline time. Position
// is the center as a fraction of the output; sizes are fractions too.
export type OverlayBase = {
  id: string;
  lane: number;
  start: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  enter: Animation;
  exit: Animation;
  // Seconds each of the enter and exit motions take.
  motion: number;
};

export type TextStyle = {
  font: string;
  // Line height as a fraction of the output height.
  size: number;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  background: string | null;
};

export type TextOverlay = OverlayBase & {
  kind: "text";
  text: string;
  style: TextStyle;
};
export type ImageOverlay = OverlayBase & {
  kind: "image";
  asset: string;
  radius: number;
};
export type VideoOverlay = OverlayBase & {
  kind: "video";
  asset: string;
  in: number;
  volume: number;
  radius: number;
};
export type ShapeKind = "arrow" | "rect" | "ellipse" | "highlight";
export type ShapeOverlay = OverlayBase & {
  kind: "shape";
  shape: ShapeKind;
  color: string;
  stroke: number;
};
// Hides what is under it: sensitive data in a recording. Strength is a
// fraction of the output's short side (blur radius or pixel block size).
export type BlurMode = "blur" | "pixelate";
export type BlurOverlay = OverlayBase & {
  kind: "blur";
  mode: BlurMode;
  strength: number;
  radius: number;
};
export type Overlay =
  | TextOverlay
  | ImageOverlay
  | VideoOverlay
  | ShapeOverlay
  | BlurOverlay;

export type AudioClip = {
  id: string;
  lane: number;
  start: number;
  duration: number;
  asset: string;
  in: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
};

// A file added to the edit, copied next to the recording (`<stem>.assets/`).
export type Asset = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  file: string;
  duration: number | null;
};

// Everything the editor adds on top of the recording. Source files are
// never modified, so every effect stays editable.
export type EditState = {
  version: 2;
  aspect: AspectId;
  background: EditBackground;
  // Fraction of the output's short side left around a flat video.
  padding: number;
  // Corner radius in output pixels at a 1080p reference.
  radius: number;
  // 0..1 strength of the drop shadow.
  shadow: number;
  // Main track, played back to back. Zooms below are in source time.
  clips: MainClip[];
  overlays: Overlay[];
  audio: AudioClip[];
  assets: Asset[];
  zooms: ZoomSegment[];
  touch: { style: TouchStyle; color: string; size: number };
  // Synthetic mouse pointer drawn from the recorded moves (never burned in the capture).
  cursor: { visible: boolean; size: number };
  sound: { clicks: boolean; volume: number };
  // null: the recording is shown as one flat video (older captures).
  layers: LayerEdit[] | null;
  camera: CameraEdit;
  mic: { volume: number };
  // Track switches, as in an NLE: hidden overlay lanes, muted music lanes, muted mic.
  tracks: { hidden: number[]; muted: number[]; micMuted: boolean };
};

export type Camera = { scale: number; center: Point };

export type TouchMark = {
  x: number;
  y: number;
  scale: number;
  opacity: number;
};

/** Geometry of a device frame at its natural size (from the Device Engine). */
export type FrameGeometry = { frame: Size; screen: Rect };

export type PlacedLayer = {
  instanceId: string;
  // Frame center in output px, px per frame unit, radians.
  center: Point;
  scale: number;
  rotation: number;
  geometry: FrameGeometry;
  // Source pixels of this screen in the captured video.
  crop: Rect;
  frame: boolean;
};

export type Frame = {
  output: Size;
  // Flat mode: where the video sits. Layered mode: the stage area.
  content: Rect;
  layers: PlacedLayer[];
  camera: Camera;
  touches: TouchMark[];
  cursor: (Point & { pressed: number }) | null;
  // Webcam overlay, in output px (drawn above the zoom).
  webcam: Rect | null;
};
