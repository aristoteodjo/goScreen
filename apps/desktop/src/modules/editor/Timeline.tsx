import {
  constrainSegment,
  formatTime,
  placeZoom,
  rulerStep,
  type ZoomSegment,
} from "@goscreen/render-engine";
import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { player, useSession } from "./session";
import { trimEnd, useEdit, usePlayback } from "./store";

const MIN_CLIP = 0.5;

type Drag = (clientX: number) => void;

/** Pointer-captured drag; `onMove` gets the time under the pointer. */
function useDrag(toTime: (clientX: number) => number) {
  return (e: PointerEvent<HTMLElement>, onMove: (t: number, dt: number) => void) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = toTime(e.clientX);
    const move: Drag = (x) => {
      const t = toTime(x);
      onMove(t, t - start);
    };
    const onPointerMove = (ev: globalThis.PointerEvent) => move(ev.clientX);
    const stop = () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  };
}

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const duration = usePlayback((s) => s.duration);
  const edit = useEdit((s) => s.edit);
  const change = useEdit((s) => s.change);
  const selected = usePlayback((s) => s.selectedZoom);
  const selectZoom = usePlayback((s) => s.selectZoom);
  const pointers = useSession((s) => s.pointers);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = duration > 0 ? width / duration : 0;
  const x = (t: number) => t * pps;
  const toTime = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const drag = useDrag(toTime);

  const step = pps > 0 ? rulerStep(pps) : 1;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step / 2) out.push(t);
    return out;
  }, [duration, step]);
  const taps = useMemo(() => pointers.filter((p) => p.kind === "down").map((p) => p.t), [pointers]);

  const end = trimEnd(edit, duration);

  const dragTrim = (edge: "start" | "end") => (e: PointerEvent<HTMLElement>) =>
    drag(e, (t) =>
      change(
        (ed) => {
          const curEnd = trimEnd(ed, duration);
          if (edge === "start") {
            return { ...ed, trim: { ...ed.trim, start: Math.min(Math.max(0, t), curEnd - MIN_CLIP) } };
          }
          const next = Math.max(Math.min(duration, t), ed.trim.start + MIN_CLIP);
          return { ...ed, trim: { ...ed.trim, end: next >= duration - 0.01 ? null : next } };
        },
        `trim-${edge}`,
      ),
    );

  const dragZoom = (z: ZoomSegment, mode: "move" | "start" | "end") => (e: PointerEvent<HTMLElement>) => {
    selectZoom(z.id);
    drag(e, (t, dt) =>
      change((ed) => {
        const raw =
          mode === "move"
            ? { start: z.start + dt, end: z.end + dt }
            : mode === "start"
              ? { start: t, end: z.end }
              : { start: z.start, end: t };
        const next = constrainSegment(ed.zooms, z.id, raw.start, raw.end, duration, mode);
        return { ...ed, zooms: ed.zooms.map((s) => (s.id === z.id ? { ...s, ...next } : s)) };
      }, `zoom-${mode}-${z.id}`),
    );
  };

  const addZoomAt = (t: number) => {
    const slot = placeZoom(edit.zooms, t, duration);
    if (!slot) return;
    const id = `zoom-${Date.now().toString(36)}`;
    change((ed) => ({ ...ed, zooms: [...ed.zooms, { id, ...slot, scale: 2, focus: null }] }));
    selectZoom(id);
  };

  return (
    <div className="shrink-0 select-none px-6 pb-4">
      <div ref={trackRef} className="relative">
        {/* Ruler */}
        <div
          className="relative h-7 cursor-pointer"
          onPointerDown={(e) => {
            player.seek(toTime(e.clientX));
            drag(e, (t) => player.seek(t));
          }}
        >
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

        {/* Clip track */}
        <div className="relative mt-1 h-12 rounded-lg bg-white/[0.03]">
          <div
            className="absolute inset-y-0 flex flex-col items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-amber-500 to-amber-600 text-amber-950 shadow-inner"
            style={{ left: x(edit.trim.start), width: Math.max(0, x(end) - x(edit.trim.start)) }}
            onPointerDown={(e) => {
              player.seek(toTime(e.clientX));
              drag(e, (t) => player.seek(t));
            }}
          >
            <span className="text-[10.5px] font-medium opacity-60">Clip</span>
            <span className="font-mono text-[12px] font-semibold tabular-nums">{(end - edit.trim.start).toFixed(1)}s</span>
            <TrimHandle side="start" onPointerDown={dragTrim("start")} />
            <TrimHandle side="end" onPointerDown={dragTrim("end")} />
          </div>
          {taps.map((t, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: taps are immutable for a session
              key={i}
              className="pointer-events-none absolute bottom-1 size-1.5 -translate-x-1/2 rounded-full bg-white/80"
              style={{ left: x(t) }}
            />
          ))}
        </div>

        {/* Zoom track */}
        <div
          className="group/zooms relative mt-2 h-11 cursor-copy rounded-lg bg-white/[0.03]"
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
          {hover !== null && placeZoom(edit.zooms, hover, duration) ? (
            <div
              className="pointer-events-none absolute inset-y-1 flex w-6 -translate-x-1/2 items-center justify-center rounded-md bg-violet-500/30 text-violet-200"
              style={{ left: x(hover) }}
            >
              <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            </div>
          ) : null}
          {edit.zooms.map((z) => (
            <div
              key={z.id}
              className={cn(
                "absolute inset-y-0 flex cursor-grab items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 text-[12px] text-white active:cursor-grabbing",
                selected === z.id && "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
              )}
              style={{ left: x(z.start), width: Math.max(4, x(z.end) - x(z.start)) }}
              onPointerDown={dragZoom(z, "move")}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerEnter={() => setHover(null)}
            >
              <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={2} />
              <span className="font-mono tabular-nums">{z.scale.toFixed(1)}×</span>
              <span className="opacity-70">{z.focus ? "Manual" : "Auto"}</span>
              <EdgeHandle side="start" onPointerDown={dragZoom(z, "start")} />
              <EdgeHandle side="end" onPointerDown={dragZoom(z, "end")} />
            </div>
          ))}
        </div>

        <Playhead x={x} />
      </div>
    </div>
  );
}

function TrimHandle({ side, onPointerDown }: { side: "start" | "end"; onPointerDown: (e: PointerEvent<HTMLElement>) => void }) {
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center bg-amber-950/25 hover:bg-amber-950/40",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <div className="h-4 w-0.5 rounded-full bg-amber-950/60" />
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
    <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-violet-400" style={{ left: x(time) }}>
      <div className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-violet-400" />
    </div>
  );
}
