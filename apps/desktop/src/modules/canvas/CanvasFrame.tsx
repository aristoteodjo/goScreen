import { type ResizeEdge, resizeViewport } from "@goscreen/device-engine";
import { Cancel01Icon, RefreshIcon, RotateClockwiseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PointerEvent, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { DeviceMockup } from "@/modules/device/DeviceMockup";
import { type CanvasPoint, frameSizeOf, type ProjectDevice, useProject } from "@/modules/studio/store/project";
import { useEditor } from "@/modules/studio/store/editor";
import { snapViewportSize } from "./snap";
import { useCanvasView } from "./view";

type Props = {
  device: ProjectDevice;
  position: CanvasPoint;
  url: string;
  selected: boolean;
  framesInteractive: boolean;
};

// Sizes that must stay readable whatever the zoom are divided by it.
const screenPx = (px: number) => `calc(${px}px / var(--canvas-zoom, 1))`;

export function CanvasFrame({ device, position, url, selected, framesInteractive }: Props) {
  const def = registry.get(device.deviceId);
  const select = useEditor((s) => s.select);
  const moveOnCanvas = useProject((s) => s.moveOnCanvas);
  const updateDevice = useProject((s) => s.updateDevice);
  const removeDevice = useProject((s) => s.removeDevice);
  const setSynced = useProject((s) => s.setSynced);
  const setInteracting = useCanvasView((s) => s.setInteracting);
  const [resizing, setResizing] = useState(false);

  if (!def) return null;
  const frame = frameSizeOf(device);
  const viewport = device.viewport ?? { width: def.viewport.width, height: def.viewport.height };
  const shown =
    device.orientation === "portrait" ? viewport : { width: viewport.height, height: viewport.width };

  const startMove = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(device.id);
    const zoom = useCanvasView.getState().zoom;
    const origin = { x: e.clientX, y: e.clientY };
    const from = position;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setInteracting(true);
    const onMove = (ev: globalThis.PointerEvent) =>
      moveOnCanvas(device.id, {
        x: Math.round(from.x + (ev.clientX - origin.x) / zoom),
        y: Math.round(from.y + (ev.clientY - origin.y) / zoom),
      });
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      setInteracting(false);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp, { once: true });
    el.addEventListener("pointercancel", onUp, { once: true });
  };

  const startResize = (edge: ResizeEdge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(device.id);
    const zoom = useCanvasView.getState().zoom;
    const origin = { x: e.clientX, y: e.clientY };
    const start = viewport;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setInteracting(true);
    setResizing(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      const raw = resizeViewport(
        start,
        device.orientation,
        edge,
        (ev.clientX - origin.x) / zoom,
        (ev.clientY - origin.y) / zoom,
      );
      updateDevice(device.id, { viewport: snapViewportSize(raw, ev.shiftKey) });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      setInteracting(false);
      setResizing(false);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp, { once: true });
    el.addEventListener("pointercancel", onUp, { once: true });
  };

  return (
    <div className="absolute" style={{ left: position.x, top: position.y, width: frame.width, height: frame.height }}>
      <div
        className="absolute bottom-full left-0 origin-bottom-left pb-2"
        style={{ width: `calc(${frame.width}px * var(--canvas-zoom, 1))`, transform: "scale(calc(1 / var(--canvas-zoom, 1)))" }}
      >
        <div
          className={cn(
            "flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
            selected ? "bg-signal/15 text-foreground" : "text-muted-foreground hover:bg-white/5",
          )}
        >
          <button
            type="button"
            onPointerDown={startMove}
            className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
          >
            <span className="truncate font-medium text-foreground">{def.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums opacity-70">
              {shown.width}×{shown.height}
            </span>
            {device.viewport ? <span className="shrink-0 text-[10.5px] text-signal">custom</span> : null}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex shrink-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-white/5">
                <Checkbox
                  id={`sync-${device.id}`}
                  checked={device.synced}
                  onCheckedChange={(v) => setSynced(device.id, v === true)}
                  className="size-3.5"
                />
                <label htmlFor={`sync-${device.id}`} className="cursor-pointer text-[11px]">
                  Sync
                </label>
              </div>
            </TooltipTrigger>
            <TooltipContent>Follow the shared URL and scroll</TooltipContent>
          </Tooltip>
          <FrameButton
            label="Rotate"
            icon={RotateClockwiseIcon}
            onClick={() =>
              updateDevice(device.id, { orientation: device.orientation === "portrait" ? "landscape" : "portrait" })
            }
          />
          {device.viewport ? (
            <FrameButton
              label="Reset to native size"
              icon={RefreshIcon}
              onClick={() => updateDevice(device.id, { viewport: null })}
            />
          ) : null}
          <FrameButton label="Remove" icon={Cancel01Icon} onClick={() => removeDevice(device.id)} />
        </div>
      </div>

      <DeviceMockup
        instance={device}
        url={url}
        selected={selected}
        framesInteractive={framesInteractive}
        onFramePointerDown={startMove}
      />

      <Handle edge="right" onPointerDown={startResize("right")} />
      <Handle edge="bottom" onPointerDown={startResize("bottom")} />
      <Handle edge="corner" onPointerDown={startResize("corner")} />

      {resizing ? (
        <div
          className="pointer-events-none absolute top-full left-1/2 mt-3 origin-top -translate-x-1/2 rounded-md bg-signal px-2 py-0.5 font-mono text-xs text-signal-foreground tabular-nums"
          style={{ transform: "translateX(-50%) scale(calc(1 / var(--canvas-zoom, 1)))" }}
        >
          {shown.width} × {shown.height}
        </div>
      ) : null}
    </div>
  );
}

function Handle({ edge, onPointerDown }: { edge: ResizeEdge; onPointerDown: (e: PointerEvent<HTMLDivElement>) => void }) {
  const thickness = screenPx(10);
  const style =
    edge === "right"
      ? { top: 0, bottom: 0, left: "100%", width: thickness, cursor: "ew-resize" }
      : edge === "bottom"
        ? { left: 0, right: 0, top: "100%", height: thickness, cursor: "ns-resize" }
        : { left: "100%", top: "100%", width: screenPx(16), height: screenPx(16), cursor: "nwse-resize" };
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className="group/handle absolute z-10 flex items-center justify-center"
      style={style}
    >
      <div
        className={cn(
          "rounded-full bg-signal opacity-0 transition-opacity group-hover/handle:opacity-100",
          edge === "corner" && "size-full rounded-sm opacity-40",
        )}
        style={
          edge === "right"
            ? { width: screenPx(3), height: "min(64px, 40%)" }
            : edge === "bottom"
              ? { height: screenPx(3), width: "min(64px, 40%)" }
              : undefined
        }
      />
    </div>
  );
}

type IconType = typeof Cancel01Icon;

function FrameButton({ label, icon, onClick }: { label: string; icon: IconType; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-white/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
