import { composeFrame, fitInto, hitLayer, outputSize, type Point } from "@goscreen/render-engine";
import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { drawFrame } from "./render";
import { currentTimeline, requestPaint, setPainter, useSession } from "./session";
import { useEdit, usePlayback } from "./store";

const MARGIN = 24;

export function Preview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const source = useSession((s) => s.source);
  const aspect = useEdit((s) => s.edit.aspect);
  const quality = usePlayback((s) => s.quality);
  const selectedZoom = usePlayback((s) => s.selectedZoom);
  const selectedLayer = usePlayback((s) => s.selectedLayer);
  const hasLayers = useEdit((s) => s.edit.layers !== null);
  const recordedLayers = useSession((s) => s.layers.length);
  const layered = hasLayers && recordedLayers > 0;

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const output = useMemo(() => (source ? outputSize(aspect, source) : null), [aspect, source]);
  const css = output
    ? fitInto({ width: Math.max(0, box.width - MARGIN * 2), height: Math.max(0, box.height - MARGIN * 2) }, output)
    : null;
  const dpr = window.devicePixelRatio || 1;
  const backingW = css ? Math.max(2, Math.round(css.width * dpr * quality)) : 0;
  const backingH = css ? Math.max(2, Math.round(css.height * dpr * quality)) : 0;

  // Paints straight from the stores: playback never re-renders React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !output || !backingW || !backingH) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setPainter(() => {
      const timeline = currentTimeline();
      const { video, camera } = useSession.getState();
      if (!timeline) return;
      const { edit } = useEdit.getState();
      const t = usePlayback.getState().time;
      const ready = video && video.readyState >= 2 ? video : null;
      drawFrame(ctx, { video: ready, camera }, composeFrame(edit, timeline, output, t), edit, canvas.width / output.width, timeline);
    });
    requestPaint();
    return () => setPainter(null);
  }, [output, backingW, backingH]);

  useEffect(() => {
    const offEdit = useEdit.subscribe(requestPaint);
    const offTime = usePlayback.subscribe((s, prev) => {
      if (!s.playing && s.time !== prev.time) requestPaint();
    });
    return () => {
      offEdit();
      offTime();
    };
  }, []);

  /** Pointer -> output pixel, undoing the zoom camera. */
  const toOutput = (clientX: number, clientY: number): Point | null => {
    const timeline = currentTimeline();
    const canvas = canvasRef.current;
    if (!output || !timeline || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const frame = composeFrame(useEdit.getState().edit, timeline, output, usePlayback.getState().time);
    const sx = ((clientX - r.left) / r.width) * output.width;
    const sy = ((clientY - r.top) / r.height) * output.height;
    return {
      x: (sx - output.width / 2) / frame.camera.scale + frame.camera.center.x,
      y: (sy - output.height / 2) / frame.camera.scale + frame.camera.center.y,
    };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !output) return;
    const p = toOutput(e.clientX, e.clientY);
    const timeline = currentTimeline();
    if (!p || !timeline) return;
    const { change } = useEdit.getState();

    // With a zoom selected, a click pins where it looks.
    if (selectedZoom) {
      const focus = { x: Math.max(0, Math.min(1, p.x / output.width)), y: Math.max(0, Math.min(1, p.y / output.height)) };
      change((ed) => ({ ...ed, zooms: ed.zooms.map((z) => (z.id === selectedZoom ? { ...z, focus } : z)) }));
      return;
    }
    if (!layered) return;

    const frame = composeFrame(useEdit.getState().edit, timeline, output, usePlayback.getState().time);
    const id = hitLayer(frame.layers, p);
    usePlayback.getState().selectLayer(id);
    if (!id) return;

    // Drag the device; positions are fractions of the stage area.
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = useEdit.getState().edit.layers?.find((l) => l.instanceId === id);
    if (!start) return;
    const area = frame.content;
    const onMove = (ev: globalThis.PointerEvent) => {
      const q = toOutput(ev.clientX, ev.clientY);
      if (!q) return;
      const x = start.x + (q.x - p.x) / area.width;
      const y = start.y + (q.y - p.y) / area.height;
      change(
        (ed) => ({ ...ed, layers: ed.layers?.map((l) => (l.instanceId === id ? { ...l, x, y } : l)) ?? null }),
        `move-${id}`,
      );
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <div ref={hostRef} className="relative flex min-h-0 flex-1 items-center justify-center">
      {css ? (
        <canvas
          ref={canvasRef}
          width={backingW}
          height={backingH}
          onPointerDown={onPointerDown}
          className={cn(
            "rounded-sm shadow-2xl",
            selectedZoom ? "cursor-crosshair" : layered && "cursor-grab active:cursor-grabbing",
          )}
          style={{ width: css.width, height: css.height }}
        />
      ) : null}
      {selectedZoom ? (
        <Hint>Click where the zoom should look</Hint>
      ) : layered && !selectedLayer ? (
        <Hint>Click a device to restyle it, drag to move it</Hint>
      ) : null}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white backdrop-blur">
      {children}
    </div>
  );
}
