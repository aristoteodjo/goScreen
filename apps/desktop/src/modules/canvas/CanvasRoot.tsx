import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { deviceUrl, useProject } from "@/modules/studio/store/project";
import { useRecording } from "@/modules/recording/store";
import { useEditor } from "@/modules/studio/store/editor";
import { CanvasFrame } from "./CanvasFrame";
import { attachCanvas, canvasCommands } from "./commands";
import { type View, zoomAt } from "./math";
import { useCanvasView } from "./view";
import { ZoomControls } from "./ZoomControls";
import { ViewContextMenu } from "@/modules/studio/components/StudioContextMenus";

// Dot grid spacing stays between 12 and 48 screen px at any zoom.
function gridSize(zoom: number) {
  let size = 24 * zoom;
  while (size < 12) size *= 2;
  while (size > 48) size /= 2;
  return size;
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function CanvasRoot() {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const devices = useProject((s) => s.devices);
  const positions = useProject((s) => s.canvas);
  const url = useProject((s) => s.url);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const interacting = useCanvasView((s) => s.interacting);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // The transform is written straight to the DOM: panning must not re-render
  // the frames, each of which hosts a live page.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    if (!host || !layer) return;
    attachCanvas(host, layer);
    const apply = (v: View) => {
      layer.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
      layer.style.setProperty("--canvas-zoom", String(v.zoom));
      const g = gridSize(v.zoom);
      host.style.backgroundSize = `${g}px ${g}px`;
      host.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
    };
    apply(useCanvasView.getState());
    const unsubscribe = useCanvasView.subscribe(apply);
    return () => {
      unsubscribe();
      attachCanvas(null, null);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // The recorded region is fixed for the whole take.
      if (useRecording.getState().active) return;
      const v = useCanvasView.getState();
      // Trackpad pinch arrives as ctrl+wheel on macOS.
      if (e.ctrlKey || e.metaKey) {
        const r = host.getBoundingClientRect();
        const delta = Math.max(-60, Math.min(60, e.deltaY));
        v.setView(zoomAt(v, v.zoom * Math.exp(-delta * 0.01), e.clientX - r.left, e.clientY - r.top));
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        v.setView({ zoom: v.zoom, panX: v.panX - dx, panY: v.panY - dy });
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        canvasCommands.reset();
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        canvasCommands.zoomBy(1);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        canvasCommands.zoomBy(-1);
      } else if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        canvasCommands.fit();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Frame the scene the first time devices appear.
  const hasDevices = devices.length > 0;
  useEffect(() => {
    if (hasDevices) requestAnimationFrame(() => canvasCommands.fit());
  }, [hasDevices]);

  const startPan = (e: PointerEvent<HTMLDivElement>) => {
    if (useRecording.getState().active) return;
    const onBackground = e.target === hostRef.current || e.target === layerRef.current;
    if (!(e.button === 1 || (e.button === 0 && (onBackground || spaceHeld)))) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const from = useCanvasView.getState();
    let moved = false;
    useCanvasView.getState().setInteracting(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      useCanvasView.getState().setView({ zoom: from.zoom, panX: from.panX + dx, panY: from.panY + dy });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      useCanvasView.getState().setInteracting(false);
      if (!moved && onBackground) select(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp, { once: true });
    el.addEventListener("pointercancel", onUp, { once: true });
  };

  return (
    <ViewContextMenu>
    <div
      ref={hostRef}
      onPointerDown={startPan}
      className="relative min-h-0 flex-1 overflow-hidden bg-stage"
      style={{
        backgroundImage: "radial-gradient(circle, oklch(1 0 0 / 8%) 1px, transparent 1.2px)",
        cursor: spaceHeld ? "grab" : undefined,
      }}
    >
      <div
        ref={layerRef}
        className="absolute top-0 left-0 origin-top-left data-[animating=true]:transition-transform data-[animating=true]:duration-200 data-[animating=true]:ease-out motion-reduce:transition-none"
      >
        {devices.map((d) => {
          const p = positions[d.id];
          if (!p) return null;
          return (
            <CanvasFrame
              key={d.id}
              device={d}
              position={p}
              url={deviceUrl(d, url)}
              selected={d.id === selectedId}
              framesInteractive={!interacting && !spaceHeld}
            />
          );
        })}
      </div>
      {spaceHeld ? <div className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing" onPointerDown={startPan} /> : null}
      {hasDevices ? <ZoomControls /> : <EmptyCanvas />}
    </div>
    </ViewContextMenu>
  );
}

function EmptyCanvas() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm font-medium">Add devices to compare them side by side</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick one in the left panel, or press <kbd className="font-mono">Cmd K</kbd>.
        </p>
      </div>
    </div>
  );
}
