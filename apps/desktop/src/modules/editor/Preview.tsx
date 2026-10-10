import {
  activeOverlays,
  composeFrame,
  type EditState,
  fitInto,
  hitLayer,
  type Overlay,
  outputSize,
  type Point,
  type Size,
  sourceTimeAt,
} from "@goscreen/render-engine";
import {
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { overlayBox } from "./drawOverlays";
import { imageFor, pooled, prunePool } from "./media";
import { PreviewMenu, type PreviewTarget } from "./PreviewMenu";
import { drawAt, type TimelineSources } from "./render";
import {
  assetUrl,
  currentTimeline,
  requestPaint,
  setPainter,
  useSession,
} from "./session";
import { previewStill } from "./stills";
import { useEdit, usePlayback } from "./store";

/** Live media for overlays, from the preview pools. */
function previewSources(
  edit: EditState,
  output: Size,
  pixelScale: number,
): TimelineSources {
  const { video, camera } = useSession.getState();
  return {
    stillOf: (p) => previewStill(p, edit, output, pixelScale),
    video: video && video.readyState >= 2 ? video : null,
    camera,
    mediaOf: (o) => {
      if (o.kind !== "image" && o.kind !== "video") return null;
      const url = assetUrl(edit, o.asset);
      if (!url) return null;
      if (o.kind === "image") return imageFor(url, requestPaint);
      const el = pooled(o.id, "video", url, requestPaint) as HTMLVideoElement;
      el.muted = true;
      return el.readyState >= 2 ? el : null;
    },
  };
}

/** Keeps one media element per video overlay and audio clip, for playback. */
function syncPool(edit: EditState) {
  const alive = new Set<string>();
  for (const o of edit.overlays) {
    const url = o.kind === "video" ? assetUrl(edit, o.asset) : null;
    if (!url) continue;
    alive.add(o.id);
    pooled(o.id, "video", url, requestPaint);
  }
  for (const a of edit.audio) {
    const url = assetUrl(edit, a.asset);
    if (!url) continue;
    alive.add(a.id);
    pooled(a.id, "audio", url, requestPaint);
  }
  prunePool(alive);
}

/** Top-most overlay under an output point at time t. */
function hitOverlay(
  overlays: Overlay[],
  t: number,
  p: Point,
  out: Size,
): Overlay | null {
  const shown = activeOverlays(overlays, t);
  for (let i = shown.length - 1; i >= 0; i -= 1) {
    const r = overlayBox(shown[i], out);
    const pad = 6;
    if (
      p.x >= r.x - pad &&
      p.x <= r.x + r.width + pad &&
      p.y >= r.y - pad &&
      p.y <= r.y + r.height + pad
    )
      return shown[i];
  }
  return null;
}

const MARGIN = 24;

export function Preview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const source = useSession((s) => s.source);
  const aspect = useEdit((s) => s.edit.aspect);
  const quality = usePlayback((s) => s.quality);
  const viewZoom = usePlayback((s) => s.viewZoom);
  const tool = usePlayback((s) => s.tool);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menuTarget, setMenuTarget] = useState<PreviewTarget | null>(null);
  const selectedZoom = usePlayback((s) => s.selectedZoom);
  const selectedLayer = usePlayback((s) => s.selectedLayer);
  const hasLayers = useEdit((s) => s.edit.layers !== null);
  const recordedLayers = useSession((s) => s.layers.length);
  const layered = hasLayers && recordedLayers > 0;

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const output = useMemo(
    () => (source ? outputSize(aspect, source) : null),
    [aspect, source],
  );
  const fit = output
    ? fitInto(
        {
          width: Math.max(0, box.width - MARGIN * 2),
          height: Math.max(0, box.height - MARGIN * 2),
        },
        output,
      )
    : null;
  const css =
    output && fit && viewZoom !== null
      ? { width: output.width * viewZoom, height: output.height * viewZoom }
      : fit;
  const dpr = window.devicePixelRatio || 1;
  // Never more backing pixels than the output has: zooming in shows real pixels, not a huge canvas.
  const density = css && output ? Math.min(dpr, output.width / css.width) : dpr;
  const backingW = css
    ? Math.max(2, Math.round(css.width * density * quality))
    : 0;
  const backingH = css
    ? Math.max(2, Math.round(css.height * density * quality))
    : 0;

  // Cmd + wheel (or a trackpad pinch) zooms the preview around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !output || !fit) return;
      e.preventDefault();
      const { viewZoom: current, setViewZoom } = usePlayback.getState();
      const fitZoom = fit.width / output.width;
      const from = current ?? fitZoom;
      const next = Math.max(
        0.1,
        Math.min(
          4,
          from * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01),
        ),
      );
      setViewZoom(next <= fitZoom * 1.001 && from > next ? null : next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [output, fit]);

  // Hand tool or Space held: drag scrolls the preview.
  const pan = (e: PointerEvent<HTMLElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    const onMove = (ev: globalThis.PointerEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x);
      el.scrollTop = start.top - (ev.clientY - start.y);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // Paints straight from the stores: playback never re-renders React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !output || !backingW || !backingH) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setPainter(() => {
      const timeline = currentTimeline();
      if (!timeline) return;
      const { edit } = useEdit.getState();
      const t = usePlayback.getState().time;
      drawAt(
        ctx,
        previewSources(edit, output, canvas.width / output.width),
        edit,
        timeline,
        output,
        t,
        canvas.width / output.width,
      );
    });
    requestPaint();
    return () => setPainter(null);
  }, [output, backingW, backingH]);

  useEffect(() => {
    syncPool(useEdit.getState().edit);
    const offPool = useEdit.subscribe((s, prev) => {
      if (
        s.edit.overlays !== prev.edit.overlays ||
        s.edit.audio !== prev.edit.audio
      )
        syncPool(s.edit);
    });
    const offAssets = useSession.subscribe((s, prev) => {
      if (s.assetUrls !== prev.assetUrls) syncPool(useEdit.getState().edit);
    });
    const offEdit = useEdit.subscribe(requestPaint);
    const offTime = usePlayback.subscribe((s, prev) => {
      if (!s.playing && s.time !== prev.time) requestPaint();
    });
    return () => {
      offPool();
      offAssets();
      offEdit();
      offTime();
    };
  }, []);

  /** Pointer -> output pixel, before the zoom camera (overlays live here). */
  const toScreen = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!output || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * output.width,
      y: ((clientY - r.top) / r.height) * output.height,
    };
  };

  /** The recording frame under the playhead, or null on a slide. */
  const frameNow = () => {
    const timeline = currentTimeline();
    const { edit } = useEdit.getState();
    const s = sourceTimeAt(edit.clips, usePlayback.getState().time);
    if (!output || !timeline || s === null) return null;
    return { frame: composeFrame(edit, timeline, output, s), timeline };
  };

  /** Pointer -> output pixel, undoing the zoom camera. */
  const toOutput = (clientX: number, clientY: number): Point | null => {
    const now = frameNow();
    const canvas = canvasRef.current;
    if (!output || !now || !canvas) return null;
    const { frame } = now;
    const r = canvas.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * output.width;
    const sy = ((clientY - r.top) / r.height) * output.height;
    return {
      x: (sx - output.width / 2) / frame.camera.scale + frame.camera.center.x,
      y: (sy - output.height / 2) / frame.camera.scale + frame.camera.center.y,
    };
  };

  /** What a right-click lands on: an overlay first, then a device, else empty space. */
  const targetAt = (clientX: number, clientY: number): PreviewTarget | null => {
    if (!output) return null;
    const screen = toScreen(clientX, clientY);
    if (!screen) return null;
    const t = usePlayback.getState().time;
    const hit = hitOverlay(useEdit.getState().edit.overlays, t, screen, output);
    if (hit) return { kind: "overlay", id: hit.id };
    const p = toOutput(clientX, clientY);
    const now = frameNow();
    const id = p && now ? hitLayer(now.frame.layers, p) : null;
    if (id) return { kind: "layer", id };
    return {
      kind: "empty",
      at: { x: screen.x / output.width, y: screen.y / output.height },
    };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (
      e.button === 1 ||
      (e.button === 0 && usePlayback.getState().tool === "hand")
    ) {
      pan(e);
      return;
    }
    if (e.button !== 0 || !output) return;
    const { change } = useEdit.getState();

    // Overlays sit above everything: they take the click first.
    const screen = toScreen(e.clientX, e.clientY);
    const t = usePlayback.getState().time;
    const hit = screen
      ? hitOverlay(useEdit.getState().edit.overlays, t, screen, output)
      : null;
    if (hit && screen) {
      usePlayback.getState().select({ kind: "overlay", id: hit.id });
      dragOverlay(e, hit, screen, "move");
      return;
    }

    const p = toOutput(e.clientX, e.clientY);
    const now = frameNow();
    if (!p || !now) {
      usePlayback.getState().select(null);
      return;
    }

    // With a zoom selected, a click pins where it looks.
    if (selectedZoom) {
      const focus = {
        x: Math.max(0, Math.min(1, p.x / output.width)),
        y: Math.max(0, Math.min(1, p.y / output.height)),
      };
      change((ed) => ({
        ...ed,
        zooms: ed.zooms.map((z) =>
          z.id === selectedZoom ? { ...z, focus } : z,
        ),
      }));
      return;
    }
    if (!layered) return;

    const { frame } = now;
    const id = hitLayer(frame.layers, p);
    usePlayback.getState().selectLayer(id);
    if (!id) return;

    // Drag the device; positions are fractions of the stage area.
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = useEdit
      .getState()
      .edit.layers?.find((l) => l.instanceId === id);
    if (!start) return;
    const area = frame.content;
    const onMove = (ev: globalThis.PointerEvent) => {
      const q = toOutput(ev.clientX, ev.clientY);
      if (!q) return;
      const x = start.x + (q.x - p.x) / area.width;
      const y = start.y + (q.y - p.y) / area.height;
      change(
        (ed) => ({
          ...ed,
          layers:
            ed.layers?.map((l) => (l.instanceId === id ? { ...l, x, y } : l)) ??
            null,
        }),
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

  /** Moves an overlay, or resizes it from its corner; sizes are fractions of the output. */
  const dragOverlay = (
    e: PointerEvent<HTMLElement>,
    o: Overlay,
    from: Point,
    mode: "move" | "resize",
  ) => {
    if (!output) return;
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: globalThis.PointerEvent) => {
      const q = toScreen(ev.clientX, ev.clientY);
      if (!q) return;
      const dx = (q.x - from.x) / output.width;
      const dy = (q.y - from.y) / output.height;
      useEdit.getState().change(
        (ed) => ({
          ...ed,
          overlays: ed.overlays.map((x) => {
            if (x.id !== o.id) return x;
            if (mode === "move") return { ...x, x: o.x + dx, y: o.y + dy };
            // Grows from the opposite corner; media keep their aspect.
            const width = Math.max(0.02, o.width + dx);
            const height =
              x.kind === "image" || x.kind === "video"
                ? (width * o.height) / o.width
                : Math.max(0.02, o.height + dy);
            return {
              ...x,
              width,
              height,
              x: o.x - o.width / 2 + width / 2,
              y: o.y - o.height / 2 + height / 2,
            };
          }),
        }),
        `overlay-${mode}-${o.id}`,
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
    <div ref={hostRef} className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className={cn(
          "absolute inset-0 flex overflow-auto",
          tool === "hand" && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(e) => {
          if (
            e.target === e.currentTarget &&
            (e.button === 1 || tool === "hand")
          )
            pan(e);
        }}
      >
        {css ? (
          <PreviewMenu target={menuTarget}>
            <div
              className="relative m-auto shrink-0"
              style={{
                width: css.width,
                height: css.height,
                margin: viewZoom === null ? "auto" : MARGIN,
              }}
              onContextMenuCapture={(e) =>
                setMenuTarget(targetAt(e.clientX, e.clientY))
              }
            >
              <canvas
                ref={canvasRef}
                data-preview-canvas
                data-output-width={output?.width}
                width={backingW}
                height={backingH}
                onPointerDown={onPointerDown}
                className={cn(
                  "block rounded-sm shadow-2xl",
                  tool === "hand"
                    ? "cursor-grab active:cursor-grabbing"
                    : selectedZoom
                      ? "cursor-crosshair"
                      : layered && "cursor-grab active:cursor-grabbing",
                )}
                style={{ width: css.width, height: css.height }}
              />
              {output ? (
                <SelectionBox
                  css={css}
                  output={output}
                  onResize={dragOverlay}
                  toScreen={toScreen}
                />
              ) : null}
            </div>
          </PreviewMenu>
        ) : null}
      </div>
      {selectedZoom ? (
        <Hint>Click where the zoom should look</Hint>
      ) : layered && !selectedLayer ? (
        <Hint>Click a device to restyle it, drag to move it</Hint>
      ) : null}
    </div>
  );
}

/** Frame and resize handle around the selected overlay, while it shows. */
function SelectionBox({
  css,
  output,
  onResize,
  toScreen,
}: {
  css: Size;
  output: Size;
  onResize: (
    e: PointerEvent<HTMLElement>,
    o: Overlay,
    from: Point,
    mode: "resize",
  ) => void;
  toScreen: (x: number, y: number) => Point | null;
}) {
  const selection = usePlayback((s) => s.selection);
  const time = usePlayback((s) => s.time);
  const overlay = useEdit((s) =>
    selection?.kind === "overlay"
      ? s.edit.overlays.find((o) => o.id === selection.id)
      : undefined,
  );
  if (
    !overlay ||
    time < overlay.start ||
    time > overlay.start + overlay.duration
  )
    return null;
  const r = overlayBox(overlay, output);
  const k = css.width / output.width;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="relative size-full">
        <div
          className="absolute border border-violet-400"
          style={{
            left: r.x * k,
            top: r.y * k,
            width: r.width * k,
            height: r.height * k,
            transform: overlay.rotation
              ? `rotate(${overlay.rotation}deg)`
              : undefined,
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-sm border border-violet-400 bg-white"
            onPointerDown={(e) => {
              const p = toScreen(e.clientX, e.clientY);
              if (p) onResize(e, overlay, p, "resize");
            }}
          />
        </div>
      </div>
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
