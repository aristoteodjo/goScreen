import type { MeshBackground } from "./background";
import type { Quad } from "./homography";
import type { ScreenLook } from "./look";

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

// Soft discs painted on the background, behind the devices: x, y are
// fractions of the output, r a fraction of its width.
export type Decor = {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity: number;
};

export type EditBackground =
  | { kind: "none" }
  | { kind: "color"; value: string; decor?: Decor[] }
  | {
      kind: "gradient";
      from: string;
      to: string;
      angle: number;
      decor?: Decor[];
    }
  // Animated, cinematic (see background.ts).
  | (MeshBackground & { decor?: Decor[] });

// focus null follows the touches inside the segment; otherwise it is a
// point of the output frame (0..1).
export type ZoomSegment = {
  id: string;
  start: number;
  end: number;
  scale: number;
  focus: Point | null;
};

export type TouchStyle = "ring" | "solid" | "ripple" | "none";

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
  | "wipe"
  // A cross fade that goes soft at the cut, like an eye refocusing.
  | "blur"
  // Momentum: the outgoing scene keeps pushing in, the next one lands from
  // further out with the sharp curve.
  | "push"
  // Continuous camera: it dives through the outgoing picture (towards
  // `focus`, expo-out, motion blurred) while the next one lands from further
  // away and settles; no cut is ever seen.
  | "zoomThrough";

// How a clip comes in over the end of the one before it. It overlaps the
// start of the clip (the sequence keeps its length); the outgoing side is
// the last frame of the previous clip. `focus`: where the camera dives on
// the outgoing side (fractions of the output; centre when absent).
export type Transition = {
  kind: TransitionKind;
  duration: number;
  focus?: Point;
};

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
  // "left": a brand card, title flush left, *words* in the accent colour.
  layout?: "center" | "left";
  eyebrow?: string;
  brand?: string;
  accent?: string;
  // Secondary text (eyebrow, subtitle) in the left layout.
  muted?: string;
  // A slow push-in over the card (scale reached at its end; 1 = still).
  push?: number;
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
  // After Effects-style: values over time, per property (see animation.ts).
  keyframes?: PropertyTracks;
  // The spoken word this layer is timed on (a sync map entry), so a QC can
  // tell whether it still lands on it: the n-th occurrence (-1: the last).
  syncWord?: { word: string; nth: number } | null;
};

/**
 * How a value travels to the next keyframe. Named curves are cubic Béziers
 * (CSS-like); "hold" jumps at the next key; spring and elastic overshoot.
 */
export type Ease =
  | "linear"
  | "hold"
  | "in"
  | "out"
  | "in-out"
  | "back"
  | "elastic"
  | "spring"
  | { bezier: [number, number, number, number] };

// `t` in seconds from the overlay's start; `ease` leads to the next key.
export type Keyframe = { t: number; value: number; ease: Ease };

// x, y: centre (fractions of the output); scale: factor; rotation: degrees;
// opacity: 0..1; blur: fraction of the output's short side.
export type AnimProp = "x" | "y" | "scale" | "rotation" | "opacity" | "blur";
export type PropertyTracks = Partial<Record<AnimProp, Keyframe[]>>;

/** Where each text unit starts before it settles (offsets in text sizes). */
export type UnitState = {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  blur: number;
};

/** After Effects-style text animator: units come in one after another. */
export type TextAnimator = {
  unit: "char" | "word" | "line";
  order: "forward" | "reverse" | "center" | "random";
  // Seconds between two units starting, and each unit's own duration.
  stagger: number;
  duration: number;
  ease: Ease;
  from: UnitState;
  // Units leave the same way at the end.
  exit: boolean;
};

export type TextStyle = {
  font: string;
  // Line height as a fraction of the output height.
  size: number;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  background: string | null;
  // A dot before the text in this colour (a chapter kicker's marker).
  bullet?: string | null;
  // Extra space between letters, in em (kickers in capitals).
  tracking?: number;
  // *Words between stars* take this colour (a light gradient, heavier,
  // a little bigger): the one word a phrase insists on.
  accent?: string | null;
  // Accent words flash two colours then settle as they come in (3 frames a step).
  flash?: boolean;
  // Glow exposure (0..0.4): peaks after the entrance, decays slowly.
  glow?: number;
  // Hard drop shadow, bottom-right, 0..1 (text over a moving picture).
  shadow?: number;
  // A band of light crosses accent words as they come in.
  sweep?: boolean;
};

// One spoken word of a caption, in seconds from the overlay's start.
export type CaptionWord = { text: string; start: number; end: number };

export type TextOverlay = OverlayBase & {
  kind: "text";
  text: string;
  style: TextStyle;
  animator?: TextAnimator | null;
  // Word-timed caption: the words are drawn as they are spoken, the one
  // being said in the accent colour. `text` holds them joined.
  words?: CaptionWord[] | null;
};
// Picture layers can float: a soft drop shadow (0..1) and a thin glow of
// this colour along the edge (a UI element popped out of the screen).
export type FloatLook = { shadow?: number; glow?: string | null };

export type ImageOverlay = OverlayBase &
  FloatLook & {
    kind: "image";
    asset: string;
    radius: number;
  };
export type LayerSource =
  | { block: string; props: Record<string, string | number> }
  | { composition: string; props: Record<string, string | number> };
export type VideoOverlay = OverlayBase &
  FloatLook & {
    kind: "video";
    asset: string;
  in: number;
  volume: number;
  radius: number;
  // A rendered block of the catalogue, or a composition (an HTML page kept
  // with the montage or in the project library): what to render it again from.
  source?: LayerSource;
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
  // Lowered while a voice speaks (music under narration). Unset: yes for
  // any sound that is not itself a voice.
  duck?: boolean;
};

// A file added to the edit, copied next to the recording (`<stem>.assets/`).
export type Asset = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  file: string;
  duration: number | null;
};

// A montage made without a recording (see blank.ts): cards and layers only.
// Width and height are the frame it was laid out on (its format at 1080p),
// what a recording's pixel size is to any other montage.
export type BlankSource = { kind: "none"; width: number; height: number };

// Everything the editor adds on top of the recording. Source files are
// never modified, so every effect stays editable.
export type EditState = {
  version: 2;
  // Absent: the montage sits on a recording (the video next to it).
  source?: BlankSource;
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
  // `spotlight`: how much the rest darkens around a click (0 = never).
  touch: { style: TouchStyle; color: string; size: number; spotlight?: number };
  // Synthetic mouse pointer drawn from the recorded moves (never burned in the capture).
  cursor: { visible: boolean; size: number };
  sound: { clicks: boolean; volume: number };
  // null: the recording is shown as one flat video (older captures).
  layers: LayerEdit[] | null;
  camera: CameraEdit;
  mic: { volume: number };
  // Track switches, as in an NLE: hidden overlay lanes, muted music lanes, muted mic.
  tracks: { hidden: number[]; muted: number[]; micMuted: boolean };
  // How recorded screens are presented (plate, outline, perspective, entrance).
  screen: ScreenLook;
  // The camera never stands still on a scene: a slow push-in and pan over
  // each scene (see camera.ts). Absent: a still camera.
  drift?: CameraDrift;
  // A scenario take's film settings (format, colours, cards...), kept so they
  // can be changed after the montage was built. Read by @goscreen/scenario.
  film?: { settings: Record<string, unknown>; locale: string };
};

export type Camera = { scale: number; center: Point };

// Permanent camera drift over a scene: `scale` is the push reached at the
// end of the scene (0.03 = 1 -> 1.03), `pan` the sideways travel as a
// fraction of the output width.
export type CameraDrift = { scale: number; pan: number };

export type TouchMark = {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  // Ripple style: 0 = the press disc, 1.. = the expanding rings.
  ring?: number;
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
  // The frame's four corners on the output (perspective included) and the
  // depth of each (px, positive = far): where touches land, what to warp.
  quad: Quad;
  depth: [number, number, number, number];
  // Lean in degrees (look tilt, drift and entrance folded in); 0,0 = flat.
  tilt: { x: number; y: number };
  opacity: number;
};

export type Frame = {
  output: Size;
  // Flat mode: where the video sits. Layered mode: the stage area.
  content: Rect;
  layers: PlacedLayer[];
  // Flat mode with a screen look: the whole video presented as one glass
  // (leaning, entering, punched), in place of `content`.
  flat: PlacedLayer | null;
  camera: Camera;
  touches: TouchMark[];
  // The rest darkens around this point (output px) by `strength` × touch.spotlight.
  spotlight: (Point & { strength: number }) | null;
  cursor: (Point & { pressed: number }) | null;
  // Webcam overlay, in output px (drawn above the zoom).
  webcam: Rect | null;
};
