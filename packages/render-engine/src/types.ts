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

// Everything the editor adds on top of the recording. Source files are
// never modified, so every effect stays editable.
export type EditState = {
  version: 1;
  aspect: AspectId;
  background: EditBackground;
  // Fraction of the output's short side left around a flat video.
  padding: number;
  // Corner radius in output pixels at a 1080p reference.
  radius: number;
  // 0..1 strength of the drop shadow.
  shadow: number;
  trim: { start: number; end: number | null };
  zooms: ZoomSegment[];
  touch: { style: TouchStyle; color: string; size: number };
  sound: { clicks: boolean; volume: number };
  // null: the recording is shown as one flat video (older captures).
  layers: LayerEdit[] | null;
  camera: CameraEdit;
  mic: { volume: number };
};

export type Camera = { scale: number; center: Point };

export type TouchMark = { x: number; y: number; scale: number; opacity: number };

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
  // Webcam overlay, in output px (drawn above the zoom).
  webcam: Rect | null;
};
