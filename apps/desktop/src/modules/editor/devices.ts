import { resolveScreenLayout } from "@goscreen/device-engine";
import type { DeviceDefinition } from "@goscreen/device-registry";
import {
  arrangeLayers,
  type FrameGeometry,
  type GeometryOf,
  type LayerEdit,
  type PlacedLayer,
  type RecordedLayer,
  type ScreenLook,
  type Size,
} from "@goscreen/render-engine";
import { registry } from "@/lib/registry";

/** Recorded glass size in portrait terms, as the Device Engine expects. */
function portraitViewport(recorded: RecordedLayer): Size {
  const { width, height } = recorded.screen;
  return recorded.orientation === "portrait"
    ? { width, height }
    : { width: height, height: width };
}

/**
 * Frame geometry for a layer. The glass keeps the recorded size (the content
 * cannot change); the chosen model only changes the hardware around it.
 */
export const geometryOf: GeometryOf = (
  edit: LayerEdit,
  recorded: RecordedLayer,
): FrameGeometry | null => {
  const device = registry.get(edit.deviceId) ?? registry.get(recorded.deviceId);
  if (!device) return null;
  if (!edit.frame) {
    return {
      frame: recorded.screen,
      screen: { x: 0, y: 0, ...recorded.screen },
    };
  }
  const layout = resolveScreenLayout(
    device,
    recorded.orientation,
    portraitViewport(recorded),
  );
  return {
    frame: layout.frame,
    screen: { x: layout.bezel, y: layout.bezel, ...layout.screen },
  };
};

/** Starting presentation: the recorded models, side by side in the stage area. */
export function initialLayers(
  recorded: RecordedLayer[],
  area: Size,
  previous: LayerEdit[] = [],
): LayerEdit[] {
  const edits = recorded.map((r) => {
    const kept = previous.find((p) => p.instanceId === r.instanceId);
    return (
      kept ?? {
        instanceId: r.instanceId,
        deviceId: r.deviceId,
        colorId: r.colorId,
        frame: true,
        x: 0.5,
        y: 0.5,
        scale: 0.8,
        rotation: r.rotation,
        hidden: false,
      }
    );
  });
  const frames = edits.map(
    (e, i) => geometryOf(e, recorded[i])?.frame ?? recorded[i].screen,
  );
  const placed = arrangeLayers(frames, area);
  return edits.map((e, i) => ({ ...e, ...placed[i] }));
}

export function deviceOf(edit: LayerEdit): DeviceDefinition | undefined {
  return registry.get(edit.deviceId);
}

type Source = {
  image: CanvasImageSource;
  crop: { x: number; y: number; width: number; height: number };
} | null;

/** The screen look resolved for one layer, in frame units. */
export type DeviceLook = {
  // Frosted plate margin around a frameless screen (0 = none).
  plate: number;
  // Outline width (0 = none) and the angle of its turning gradient (null = flat grey).
  outline: number;
  sweep: number | null;
  // Plate fill: a light or dark veil, by the background it sits on.
  plateColor: string;
};

export const NO_LOOK: DeviceLook = {
  plate: 0,
  outline: 0,
  sweep: null,
  plateColor: "rgba(255, 255, 255, 0.08)",
};

/** Plate margin in frame units: a fraction of the screen's short side. */
export function plateMargin(look: ScreenLook, layer: PlacedLayer): number {
  const { screen } = layer.geometry;
  return look.plate * Math.min(screen.width, screen.height);
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draws a device at its natural frame size, origin at the frame's top-left:
 * body, glass with the recorded screen, cutout and home indicator.
 */
export function drawDevice(
  ctx: CanvasRenderingContext2D,
  layer: PlacedLayer,
  edit: LayerEdit,
  recorded: RecordedLayer,
  source: Source,
  shadow: number,
  shadowScale: number,
  look: DeviceLook = NO_LOOK,
) {
  const device = deviceOf(edit);
  const { frame, screen } = layer.geometry;
  const portrait = recorded.orientation === "portrait";
  const color =
    device?.frame.colors.find((c) => c.id === edit.colorId) ??
    device?.frame.colors[0];
  const handheld =
    device?.category === "phone" || device?.category === "tablet";
  const screenRadius = edit.frame
    ? (device?.frame.screenRadius ?? 0)
    : Math.max(
        (device?.frame.screenRadius ?? 0) * 0.6,
        look.plate > 0 || look.outline > 0
          ? Math.min(screen.width, screen.height) * 0.035
          : 0,
      );

  // The frosted plate behind a frameless screen: a veil with equal margins,
  // soft shadow and a hairline, like the course's blurred "glass" frame.
  if (!edit.frame && look.plate > 0) {
    const m = look.plate;
    ctx.save();
    if (shadow > 0) {
      ctx.shadowColor = `rgba(0, 0, 0, ${0.4 * shadow})`;
      ctx.shadowBlur = 50 * shadow * shadowScale;
      ctx.shadowOffsetY = 20 * shadow * shadowScale;
    }
    ctx.fillStyle = look.plateColor;
    rounded(
      ctx,
      -m,
      -m,
      frame.width + m * 2,
      frame.height + m * 2,
      screenRadius + m,
    );
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    rounded(
      ctx,
      -m + 0.75,
      -m + 0.75,
      frame.width + m * 2 - 1.5,
      frame.height + m * 2 - 1.5,
      screenRadius + m,
    );
    ctx.stroke();
    ctx.restore();
    // The plate carries the shadow; the screen itself stays flat on it.
    shadow = 0;
  }

  // Body (and its shadow).
  ctx.save();
  if (shadow > 0) {
    ctx.shadowColor = `rgba(0, 0, 0, ${0.5 * shadow})`;
    ctx.shadowBlur = 60 * shadow * shadowScale;
    ctx.shadowOffsetY = 26 * shadow * shadowScale;
  }
  if (edit.frame && device && color) {
    const r = device.frame.radius;
    if (handheld) {
      const g = ctx.createLinearGradient(0, 0, frame.width, frame.height);
      g.addColorStop(0, color.edge);
      g.addColorStop(0.35, color.body);
      g.addColorStop(0.7, color.body);
      g.addColorStop(1, color.edge);
      ctx.fillStyle = g;
      rounded(ctx, 0, 0, frame.width, frame.height, r);
    } else {
      ctx.fillStyle = "#0b0b0c";
      rounded(ctx, 0, 0, frame.width, frame.height, [r, r, r / 3, r / 3]);
    }
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = handheld ? 3 : 6;
    ctx.strokeStyle = color.edge;
    if (handheld) rounded(ctx, 0, 0, frame.width, frame.height, r);
    else rounded(ctx, 0, 0, frame.width, frame.height, [r, r, r / 3, r / 3]);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    if (device.category === "laptop")
      drawLaptopBase(ctx, frame.width, frame.height, color.body, color.edge);
    if (device.category === "desktop")
      drawStand(ctx, frame.width, frame.height, color.body, color.edge);
  } else {
    ctx.fillStyle = "#000";
    rounded(ctx, 0, 0, frame.width, frame.height, screenRadius);
    ctx.fill();
    ctx.restore();
  }

  // Glass.
  ctx.save();
  rounded(ctx, screen.x, screen.y, screen.width, screen.height, screenRadius);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
  if (source && source.crop.width > 0 && source.crop.height > 0) {
    ctx.imageSmoothingQuality = "high";
    const c = source.crop;
    ctx.drawImage(
      source.image,
      c.x,
      c.y,
      c.width,
      c.height,
      screen.x,
      screen.y,
      screen.width,
      screen.height,
    );
  }

  // Hardware drawn over the glass, from the chosen model.
  const cutout = device?.cutout;
  if (edit.frame && cutout && cutout.type !== "none") {
    const w = portrait ? cutout.width : cutout.height;
    const h = portrait ? cutout.height : cutout.width;
    const x = portrait
      ? screen.x + (screen.width - w) / 2
      : screen.x + cutout.offsetTop;
    const y = portrait
      ? screen.y + cutout.offsetTop
      : screen.y + (screen.height - h) / 2;
    ctx.fillStyle = "#000";
    if (cutout.type === "notch") {
      rounded(
        ctx,
        x,
        portrait ? screen.y : y,
        w,
        portrait ? h + cutout.offsetTop : h,
        portrait ? [0, 0, 18, 18] : [0, 18, 18, 0],
      );
    } else {
      rounded(ctx, x, y, w, h, Math.min(w, h) / 2);
    }
    ctx.fill();
  }
  if (
    edit.frame &&
    device?.homeIndicator &&
    portrait &&
    recorded.source === "web"
  ) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    rounded(
      ctx,
      screen.x + (screen.width - 134) / 2,
      screen.y + screen.height - 13,
      134,
      5,
      2.5,
    );
    ctx.fill();
  }
  ctx.restore();

  // Outline on a frameless screen: a thin grey line at 50 %, or a two-tone
  // gradient whose angle turns over the scene.
  if (!edit.frame && look.outline > 0) {
    ctx.save();
    ctx.lineWidth = look.outline;
    if (look.sweep === null) {
      ctx.strokeStyle = "rgba(200, 200, 205, 0.5)";
    } else {
      const a = (look.sweep * Math.PI) / 180;
      const r = Math.hypot(frame.width, frame.height) / 2;
      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const g = ctx.createLinearGradient(
        cx - Math.cos(a) * r,
        cy + Math.sin(a) * r,
        cx + Math.cos(a) * r,
        cy - Math.sin(a) * r,
      );
      g.addColorStop(0, "rgba(255, 255, 255, 0.7)");
      g.addColorStop(1, "rgba(160, 160, 170, 0.35)");
      ctx.strokeStyle = g;
    }
    const inset = look.outline / 2;
    rounded(
      ctx,
      screen.x + inset,
      screen.y + inset,
      screen.width - look.outline,
      screen.height - look.outline,
      Math.max(0, screenRadius - inset),
    );
    ctx.stroke();
    ctx.restore();
  }
}

function drawLaptopBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  body: string,
  edge: string,
) {
  const overhang = width * 0.07;
  const h = Math.max(14, width * 0.018);
  const g = ctx.createLinearGradient(0, height, 0, height + h);
  g.addColorStop(0, edge);
  g.addColorStop(0.45, body);
  g.addColorStop(1, body);
  ctx.fillStyle = g;
  rounded(ctx, -overhang, height, width + overhang * 2, h, [2, 2, h, h]);
  ctx.fill();
}

function drawStand(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  body: string,
  edge: string,
) {
  const neckW = width * 0.16;
  const neckH = width * 0.12;
  ctx.fillStyle = body;
  ctx.fillRect((width - neckW) / 2, height, neckW, neckH);
  const footW = width * 0.36;
  const footH = Math.max(10, width * 0.012);
  ctx.fillStyle = edge;
  rounded(ctx, (width - footW) / 2, height + neckH, footW, footH, 6);
  ctx.fill();
}
