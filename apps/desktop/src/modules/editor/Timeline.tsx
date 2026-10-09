import {
  type AudioClip,
  clipDuration,
  constrainSegment,
  dropIndex,
  formatTime,
  type MainClip,
  type Overlay,
  type Placed,
  placeClips,
  placeZoom,
  type RecordingClip,
  rulerStep,
  sourceTimeAt,
  trimClip,
  type ZoomSegment,
} from "@goscreen/render-engine";
import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ComponentProps, type PointerEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { cn } from "@/lib/utils";
import { player, useSession } from "./session";
import { newId, type Selection, timelineEnd, useEdit, usePlayback } from "./store";
import { TimelineItemMenu } from "./TimelineMenus";
import { TimelineToolbar } from "./TimelineToolbar";

const LANE = 30;
const MIN_ITEM = 0.2;
const GUTTER = 24;

type Move = (dx: number, dy: number, e: globalThis.PointerEvent) => void;

/** Pointer-captured drag; `onMove` gets the pixel offset from the press. */
function startDrag(e: PointerEvent<HTMLElement>, onMove: Move, onEnd?: () => void) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const move = (ev: globalThis.PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0, ev);
  const stop = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", stop);
    el.removeEventListener("pointercancel", stop);
    onEnd?.();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
}

/**
 * Where a dragged edge or item lands. Snapping to the playhead and to the
 * edges of other items makes cuts line up without pixel hunting.
 * `candidates` are timeline times, `threshold` is in seconds.
 */
export function snapTime(t: number, candidates: number[], threshold: number): number {
  // TODO(you): return the closest candidate within `threshold`, else t.
  void candidates;
  void threshold;
  return t;
}

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const sourceDuration = usePlayback((s) => s.duration);
  const scale = usePlayback((s) => s.scale);
  const setScale = usePlayback((s) => s.setScale);
  const edit = useEdit((s) => s.edit);
  const change = useEdit((s) => s.change);
  const selection = usePlayback((s) => s.selection);
  const selectedZoom = usePlayback((s) => s.selectedZoom);
  const select = usePlayback((s) => s.select);
  const selectZoom = usePlayback((s) => s.selectZoom);
  const pointers = useSession((s) => s.pointers);
  const [hover, setHover] = useState<number | null>(null);
  // Main clip being reordered: its id and how far it has moved, in px.
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const end = timelineEnd(edit);
  const fit = end > 0 ? Math.max(1, width - GUTTER * 2) / end : 0;
  const pps = scale ?? fit;
  const x = (t: number) => t * pps;
  const toTime = (clientX: number) => {
    const r = contentRef.current?.getBoundingClientRect();
    if (!r || pps <= 0) return 0;
    return Math.max(0, Math.min(end, (clientX - r.left) / pps));
  };

  const placed = useMemo(() => placeClips(edit.clips), [edit.clips]);
  const spans = placed.filter((p): p is Placed<RecordingClip> => p.clip.kind === "recording");

  // Edges an item can snap to: playhead, clip cuts, other items.
  const snapPoints = (exclude: string) => {
    const pts = [usePlayback.getState().time, 0, end];
    for (const p of placed) pts.push(p.start, p.end);
    for (const o of [...edit.overlays, ...edit.audio]) {
      if (o.id !== exclude) pts.push(o.start, o.start + o.duration);
    }
    return pts;
  };
  const snap = (t: number, exclude: string) => snapTime(t, snapPoints(exclude), 8 / Math.max(pps, 1e-6));

  const step = pps > 0 ? rulerStep(pps) : 1;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= end + 1e-6 && out.length < 2000; t += step / 2) out.push(t);
    return out;
  }, [end, step]);

  // Taps are in source time; each clip shows the ones inside its span.
  const taps = useMemo(() => {
    const downs = pointers.filter((p) => p.kind === "down").map((p) => p.t);
    return spans.flatMap((p) =>
      downs.filter((s) => s >= p.clip.in && s < p.clip.out).map((s) => p.start + (s - p.clip.in) / p.clip.speed),
    );
  }, [pointers, spans]);

  // Zooms are in source time too: one block per clip that shows them.
  const zoomBlocks = useMemo(
    () =>
      spans.flatMap((p) =>
        edit.zooms
          .filter((z) => z.end > p.clip.in && z.start < p.clip.out)
          .map((z) => ({
            zoom: z,
            span: p,
            start: p.start + (Math.max(z.start, p.clip.in) - p.clip.in) / p.clip.speed,
            end: p.start + (Math.min(z.end, p.clip.out) - p.clip.in) / p.clip.speed,
          })),
      ),
    [spans, edit.zooms],
  );

  const seekDrag = (e: PointerEvent<HTMLElement>) => {
    const r = contentRef.current?.getBoundingClientRect();
    const t0 = toTime(e.clientX);
    player.seek(t0);
    startDrag(e, (dx) => r && player.seek(Math.max(0, Math.min(end, t0 + dx / pps))));
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const next = Math.max(fit, Math.min(400, pps * Math.exp(-e.deltaY * 0.01)));
    setScale(next <= fit * 1.001 ? null : next);
  };

  // --- Main track -------------------------------------------------------

  const dragClip = (p: Placed) => (e: PointerEvent<HTMLElement>) => {
    select({ kind: "clip", id: p.clip.id });
    const center = (p.start + p.end) / 2;
    let last = 0;
    startDrag(
      e,
      (dx) => {
        last = dx;
        if (Math.abs(dx) > 3) setMoving({ id: p.clip.id, dx });
      },
      () => {
        setMoving(null);
        if (Math.abs(last) <= 3) {
          player.seek(toTime(e.clientX));
          return;
        }
        const clips = useEdit.getState().edit.clips;
        const to = dropIndex(clips, p.clip.id, center + last / pps);
        change((ed) => {
          const next = ed.clips.filter((c) => c.id !== p.clip.id);
          next.splice(to, 0, p.clip);
          return { ...ed, clips: next };
        });
      },
    );
  };

  const trimMain = (p: Placed, edge: "start" | "end") => (e: PointerEvent<HTMLElement>) => {
    select({ kind: "clip", id: p.clip.id });
    const orig = useEdit.getState().edit.clips;
    const key = `clip-${edge}-${p.clip.id}-${Date.now()}`;
    startDrag(e, (dx) => {
      const dt = dx / pps;
      change((ed) => ({ ...ed, clips: trimClip(orig, p.clip.id, edge, dt, sourceDuration) }), key);
    });
  };

  // --- Overlays and audio ----------------------------------------------

  type Free = Overlay | AudioClip;

  const dragFree = (kind: "overlay" | "audio", item: Free, mode: "move" | "start" | "end", lanes: number) =>
    (e: PointerEvent<HTMLElement>) => {
      select({ kind, id: item.id });
      const key = `${kind}-${mode}-${item.id}-${Date.now()}`;
      const field = kind === "overlay" ? "overlays" : "audio";
      // Overlay lanes stack upwards (lane 0 nearest the video), audio downwards.
      const laneDir = kind === "overlay" ? -1 : 1;
      const assetDuration =
        "asset" in item ? (useEdit.getState().edit.assets.find((a) => a.id === item.asset)?.duration ?? null) : null;
      const hasIn = "in" in item;
      startDrag(e, (dx, dy) => {
        const dt = dx / pps;
        let patch: Partial<Free>;
        if (mode === "move") {
          const raw = Math.max(0, item.start + dt);
          const s1 = snap(raw, item.id);
          const s2 = snap(raw + item.duration, item.id) - item.duration;
          const start = Math.max(0, Math.abs(s1 - raw) <= Math.abs(s2 - raw) ? s1 : s2);
          const lane = Math.max(0, Math.min(lanes, item.lane + Math.round((dy / LANE) * laneDir)));
          patch = { start, lane };
        } else if (mode === "start") {
          const itemEnd = item.start + item.duration;
          const minStart = hasIn ? item.start - (item as { in: number }).in : 0;
          const start = Math.max(0, minStart, Math.min(snap(item.start + dt, item.id), itemEnd - MIN_ITEM));
          patch = { start, duration: itemEnd - start };
          if (hasIn) (patch as { in: number }).in = (item as { in: number }).in + (start - item.start);
        } else {
          const maxDur = assetDuration !== null && hasIn ? assetDuration - (item as { in: number }).in : Infinity;
          const endT = snap(item.start + item.duration + dt, item.id);
          patch = { duration: Math.max(MIN_ITEM, Math.min(maxDur, endT - item.start)) };
        }
        change(
          (ed) => ({
            ...ed,
            [field]: (ed[field] as Free[]).map((o) => (o.id === item.id ? { ...o, ...patch } : o)),
          }),
          key,
        );
      });
    };

  // --- Zooms (source time) ---------------------------------------------

  const dragZoom = (z: ZoomSegment, span: Placed<RecordingClip>, mode: "move" | "start" | "end") =>
    (e: PointerEvent<HTMLElement>) => {
      selectZoom(z.id);
      const key = `zoom-${mode}-${z.id}-${Date.now()}`;
      startDrag(e, (dx) => {
        const ds = (dx / pps) * span.clip.speed;
        const raw =
          mode === "move"
            ? { start: z.start + ds, end: z.end + ds }
            : mode === "start"
              ? { start: z.start + ds, end: z.end }
              : { start: z.start, end: z.end + ds };
        change((ed) => {
          const next = constrainSegment(ed.zooms, z.id, raw.start, raw.end, sourceDuration, mode);
          return { ...ed, zooms: ed.zooms.map((s) => (s.id === z.id ? { ...s, ...next } : s)) };
        }, key);
      });
    };

  const addZoomAt = (t: number) => {
    const s = sourceTimeAt(edit.clips, t);
    if (s === null) return;
    const slot = placeZoom(edit.zooms, s, sourceDuration);
    if (!slot) return;
    const id = newId("zoom");
    change((ed) => ({ ...ed, zooms: [...ed.zooms, { id, ...slot, scale: 2, focus: null }] }));
    selectZoom(id);
  };
  const canZoomAt = (t: number) => {
    const s = sourceTimeAt(edit.clips, t);
    return s !== null && placeZoom(edit.zooms, s, sourceDuration) !== null;
  };

  const overlayLanes = edit.overlays.length ? Math.max(...edit.overlays.map((o) => o.lane)) + 1 : 0;
  const audioLanes = edit.audio.length ? Math.max(...edit.audio.map((a) => a.lane)) + 1 : 0;
  const isSel = (kind: Selection["kind"], id: string) => selection?.kind === kind && selection.id === id;
  const assetName = (id: string) => edit.assets.find((a) => a.id === id)?.name ?? "Media";

  return (
    <div className="flex shrink-0 select-none flex-col border-t border-white/5">
      <TimelineToolbar />
      <div
        ref={scrollRef}
        className="max-h-[42vh] overflow-auto pb-3"
        data-timeline-pps={pps}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select(null);
        }}
      >
        <div className="relative" style={{ width: x(end) + GUTTER * 2, paddingLeft: GUTTER, paddingRight: GUTTER }}>
          <div ref={contentRef} className="relative" style={{ width: x(end) }}>
            {/* Ruler */}
            <div className="sticky top-0 z-20 h-7 cursor-pointer bg-background" onPointerDown={seekDrag}>
              {ticks.map((t) => {
                const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
                return (
                  <div key={t} className="absolute bottom-1 -translate-x-1/2" style={{ left: x(t) }}>
                    {major && t > 0 ? (
                      <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                        {formatTime(t)}
                      </span>
                    ) : null}
                    <div className={cn("size-[3px] rounded-full", major ? "bg-muted-foreground" : "bg-muted-foreground/40")} />
                  </div>
                );
              })}
            </div>

            {/* Overlay lanes, highest on top */}
            {Array.from({ length: overlayLanes }, (_, i) => overlayLanes - 1 - i).map((lane) => (
              <Lane key={`o${lane}`}>
                {edit.overlays
                  .filter((o) => o.lane === lane)
                  .map((o) => (
                    <TimelineItemMenu key={o.id} selection={{ kind: "overlay", id: o.id }}>
                      <Block
                        left={x(o.start)}
                        width={x(o.duration)}
                        selected={isSel("overlay", o.id)}
                        className={OVERLAY_COLOR[o.kind]}
                        onPointerDown={dragFree("overlay", o, "move", overlayLanes)}
                        onStart={dragFree("overlay", o, "start", overlayLanes)}
                        onEnd={dragFree("overlay", o, "end", overlayLanes)}
                      >
                        {o.kind === "text" ? o.text : o.kind === "shape" ? o.shape : assetName(o.asset)}
                      </Block>
                    </TimelineItemMenu>
                  ))}
              </Lane>
            ))}

            {/* Main track */}
            <div className="relative mt-1 h-12 rounded-lg bg-white/[0.03]">
              {placed.map((p) => (
                <TimelineItemMenu key={p.clip.id} selection={{ kind: "clip", id: p.clip.id }}>
                  <div
                    className={cn(
                      "absolute inset-y-0 flex cursor-grab flex-col items-center justify-center overflow-hidden rounded-lg border border-black/20 shadow-inner active:cursor-grabbing",
                      p.clip.kind === "recording"
                        ? "bg-gradient-to-b from-amber-500 to-amber-600 text-amber-950"
                        : "bg-gradient-to-b from-indigo-500 to-indigo-700 text-white",
                      isSel("clip", p.clip.id) && "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
                      moving?.id === p.clip.id && "z-10 opacity-80 shadow-xl",
                    )}
                    style={{
                      left: x(p.start),
                      width: Math.max(4, x(p.end - p.start)),
                      transform: moving?.id === p.clip.id ? `translateX(${moving.dx}px)` : undefined,
                    }}
                    onPointerDown={dragClip(p)}
                  >
                    <ClipLabel clip={p.clip} />
                    <TrimHandle side="start" onPointerDown={trimMain(p, "start")} />
                    <TrimHandle side="end" onPointerDown={trimMain(p, "end")} />
                  </div>
                </TimelineItemMenu>
              ))}
              {taps.map((t, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: derived positions, no identity
                  key={i}
                  className="pointer-events-none absolute bottom-1 size-1.5 -translate-x-1/2 rounded-full bg-white/80"
                  style={{ left: x(t) }}
                />
              ))}
            </div>

            {/* Zoom track */}
            <div
              className="group/zooms relative mt-1 h-9 cursor-copy rounded-lg bg-white/[0.03]"
              onPointerMove={(e) => setHover(toTime(e.clientX))}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                selectZoom(null);
                addZoomAt(toTime(e.clientX));
              }}
            >
              {edit.zooms.length === 0 && hover === null ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                  Click to add a zoom
                </span>
              ) : null}
              {hover !== null && canZoomAt(hover) ? (
                <div
                  className="pointer-events-none absolute inset-y-1 flex w-6 -translate-x-1/2 items-center justify-center rounded-md bg-violet-500/30 text-violet-200"
                  style={{ left: x(hover) }}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
                </div>
              ) : null}
              {zoomBlocks.map(({ zoom: z, span, start, end: zEnd }) => (
                <div
                  key={`${z.id}-${span.clip.id}`}
                  className={cn(
                    "absolute inset-y-0 flex cursor-grab items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 text-[12px] text-white active:cursor-grabbing",
                    selectedZoom === z.id && "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
                  )}
                  style={{ left: x(start), width: Math.max(4, x(zEnd - start)) }}
                  onPointerDown={dragZoom(z, span, "move")}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerEnter={() => setHover(null)}
                >
                  <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={2} />
                  <span className="font-mono tabular-nums">{z.scale.toFixed(1)}×</span>
                  <span className="opacity-70">{z.focus ? "Manual" : "Auto"}</span>
                  <EdgeHandle side="start" onPointerDown={dragZoom(z, span, "start")} />
                  <EdgeHandle side="end" onPointerDown={dragZoom(z, span, "end")} />
                </div>
              ))}
            </div>

            {/* Audio lanes */}
            {Array.from({ length: audioLanes }, (_, lane) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the lane number is its identity
              <Lane key={`a${lane}`}>
                {edit.audio
                  .filter((a) => a.lane === lane)
                  .map((a) => (
                    <TimelineItemMenu key={a.id} selection={{ kind: "audio", id: a.id }}>
                      <Block
                        left={x(a.start)}
                        width={x(a.duration)}
                        selected={isSel("audio", a.id)}
                        className="bg-gradient-to-b from-teal-500 to-teal-700 text-white"
                        onPointerDown={dragFree("audio", a, "move", audioLanes)}
                        onStart={dragFree("audio", a, "start", audioLanes)}
                        onEnd={dragFree("audio", a, "end", audioLanes)}
                      >
                        ♪ {assetName(a.asset)}
                      </Block>
                    </TimelineItemMenu>
                  ))}
              </Lane>
            ))}

            <Playhead x={x} />
          </div>
        </div>
      </div>
    </div>
  );
}

const OVERLAY_COLOR: Record<Overlay["kind"], string> = {
  text: "bg-gradient-to-b from-sky-500 to-sky-700 text-white",
  image: "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white",
  video: "bg-gradient-to-b from-emerald-600 to-emerald-800 text-white",
  shape: "bg-gradient-to-b from-rose-500 to-rose-700 text-white",
};

function ClipLabel({ clip }: { clip: MainClip }) {
  const seconds = clipDuration(clip).toFixed(1);
  if (clip.kind === "slide") {
    return (
      <>
        <span className="max-w-full truncate px-3 text-[11px] font-medium">{clip.title || "Slide"}</span>
        <span className="font-mono text-[11px] opacity-70 tabular-nums">{seconds}s</span>
      </>
    );
  }
  return (
    <>
      <span className="text-[10.5px] font-medium opacity-60">
        Clip{clip.speed !== 1 ? ` · ${clip.speed}×` : ""}
        {clip.muted ? " · muted" : ""}
      </span>
      <span className="font-mono text-[12px] font-semibold tabular-nums">{seconds}s</span>
    </>
  );
}

function Lane({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-1 rounded-md bg-white/[0.02]" style={{ height: LANE - 4 }}>
      {children}
    </div>
  );
}

function Block({
  left,
  width,
  selected,
  className,
  children,
  onPointerDown,
  onStart,
  onEnd,
  ...rest
}: ComponentProps<"div"> & {
  left: number;
  width: number;
  selected: boolean;
  className: string;
  children: ReactNode;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onStart: (e: PointerEvent<HTMLElement>) => void;
  onEnd: (e: PointerEvent<HTMLElement>) => void;
}) {
  // `rest` carries what a context menu trigger injects (ref, onContextMenu).
  return (
    <div
      {...rest}
      className={cn(
        "absolute inset-y-0 flex cursor-grab items-center overflow-hidden rounded-md px-2.5 text-[11px] font-medium active:cursor-grabbing",
        className,
        selected && "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
      )}
      style={{ left, width: Math.max(6, width) }}
      onPointerDown={onPointerDown}
    >
      <span className="truncate">{children}</span>
      <EdgeHandle side="start" onPointerDown={onStart} />
      <EdgeHandle side="end" onPointerDown={onEnd} />
    </div>
  );
}

function TrimHandle({ side, onPointerDown }: { side: "start" | "end"; onPointerDown: (e: PointerEvent<HTMLElement>) => void }) {
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center bg-black/20 hover:bg-black/35",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <div className="h-4 w-0.5 rounded-full bg-black/50" />
    </div>
  );
}

function EdgeHandle({ side, onPointerDown }: { side: "start" | "end"; onPointerDown: (e: PointerEvent<HTMLElement>) => void }) {
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className={cn("absolute inset-y-0 w-2 cursor-ew-resize hover:bg-white/25", side === "start" ? "left-0" : "right-0")}
    />
  );
}

// Subscribes to time on its own so playback only re-renders this line.
function Playhead({ x }: { x: (t: number) => number }) {
  const time = usePlayback((s) => s.time);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-violet-400" style={{ left: x(time) }}>
      <div className="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-violet-400" />
    </div>
  );
}
