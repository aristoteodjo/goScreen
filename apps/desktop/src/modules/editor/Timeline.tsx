import {
  type AudioClip,
  clipDuration,
  constrainSegment,
  DEFAULT_TRANSITION,
  dropIndex,
  formatTime,
  type MainClip,
  MIC_ASSET,
  type Overlay,
  type Placed,
  placeClips,
  placeZoom,
  type RecordingClip,
  rulerStep,
  sourceTimeAt,
  TRANSITION_KINDS,
  transitionLength,
  trimClip,
  type ZoomSegment,
} from "@goscreen/render-engine";
import {
  Add01Icon,
  Search01Icon,
  ViewIcon,
  ViewOffSlashIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { editActions } from "./actions";
import { assetUrl, player, useSession } from "./session";
import {
  newId,
  type Selection,
  timelineEnd,
  useEdit,
  usePlayback,
} from "./store";
import { DeviceMenu, TimelineItemMenu } from "./TimelineMenus";
import { TimelineToolbar } from "./TimelineToolbar";
import { Waveform } from "./Waveform";

const LANE = 30;
const MAIN = 52;
const MIC = 40;
const ZOOM = 34;
const MIN_ITEM = 0.2;
const GUTTER = 16;
const HEADER = 92;

type Move = (dx: number, dy: number, e: globalThis.PointerEvent) => void;

/** Pointer-captured drag; `onMove` gets the pixel offset from the press. */
function startDrag(
  e: PointerEvent<HTMLElement>,
  onMove: Move,
  onEnd?: () => void,
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const move = (ev: globalThis.PointerEvent) =>
    onMove(ev.clientX - x0, ev.clientY - y0, ev);
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
export function snapTime(
  t: number,
  candidates: number[],
  threshold: number,
): number {
  let best = t;
  let gap = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= gap) {
      best = c;
      gap = d;
    }
  }
  return best;
}

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const sourceDuration = usePlayback((s) => s.duration);
  const scale = usePlayback((s) => s.scale);
  const setScale = usePlayback((s) => s.setScale);
  const tool = usePlayback((s) => s.tool);
  const edit = useEdit((s) => s.edit);
  const change = useEdit((s) => s.change);
  const selection = usePlayback((s) => s.selection);
  const selectedZoom = usePlayback((s) => s.selectedZoom);
  const select = usePlayback((s) => s.select);
  const selectZoom = usePlayback((s) => s.selectZoom);
  const selectedLayer = usePlayback((s) => s.selectedLayer);
  const recordedLayers = useSession((s) => s.layers);
  const pointers = useSession((s) => s.pointers);
  const micUrl = useSession((s) => s.micUrl);
  const mediaOffset = useSession((s) => s.mediaOffset);
  const [hover, setHover] = useState<number | null>(null);
  // Where the blade would cut, while the pointer is over the tracks.
  const [blade, setBlade] = useState<number | null>(null);
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
  const fit = end > 0 ? Math.max(1, width - HEADER - GUTTER * 2) / end : 0;
  const pps = scale ?? fit;
  const x = (t: number) => t * pps;
  const toTime = (clientX: number) => {
    const r = contentRef.current?.getBoundingClientRect();
    if (!r || pps <= 0) return 0;
    return Math.max(0, Math.min(end, (clientX - r.left) / pps));
  };

  const placed = useMemo(() => placeClips(edit.clips), [edit.clips]);
  const spans = placed.filter(
    (p): p is Placed<RecordingClip> => p.clip.kind === "recording",
  );

  // Edges an item can snap to: playhead, clip cuts, other items.
  const snapPoints = (exclude: string) => {
    const pts = [usePlayback.getState().time, 0, end];
    for (const p of placed) pts.push(p.start, p.end);
    for (const o of [...edit.overlays, ...edit.audio]) {
      if (o.id !== exclude) pts.push(o.start, o.start + o.duration);
    }
    return pts;
  };
  const snap = (t: number, exclude: string) =>
    usePlayback.getState().snapping
      ? snapTime(t, snapPoints(exclude), 8 / Math.max(pps, 1e-6))
      : t;

  const step = pps > 0 ? rulerStep(pps) : 1;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= end + 1e-6 && out.length < 2000; t += step / 2)
      out.push(t);
    return out;
  }, [end, step]);

  // Taps are in source time; each clip shows the ones inside its span.
  const taps = useMemo(() => {
    const downs = pointers.filter((p) => p.kind === "down").map((p) => p.t);
    return spans.flatMap((p) =>
      downs
        .filter((s) => s >= p.clip.in && s < p.clip.out)
        .map((s) => p.start + (s - p.clip.in) / p.clip.speed),
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
            start:
              p.start +
              (Math.max(z.start, p.clip.in) - p.clip.in) / p.clip.speed,
            end:
              p.start +
              (Math.min(z.end, p.clip.out) - p.clip.in) / p.clip.speed,
          })),
      ),
    [spans, edit.zooms],
  );

  const seekDrag = (e: PointerEvent<HTMLElement>) => {
    const t0 = toTime(e.clientX);
    player.seek(t0);
    startDrag(e, (dx) =>
      player.seek(Math.max(0, Math.min(end, t0 + dx / pps))),
    );
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const next = Math.max(fit, Math.min(400, pps * Math.exp(-e.deltaY * 0.01)));
    setScale(next <= fit * 1.001 ? null : next);
  };

  // Hand tool (or middle button): drag scrolls the timeline.
  const panDrag = (e: PointerEvent<HTMLElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const from = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    const move = (ev: globalThis.PointerEvent) => {
      el.scrollLeft = from.left - (ev.clientX - from.x);
      el.scrollTop = from.top - (ev.clientY - from.y);
    };
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
  };

  /**
   * Tools that act on any item before its own handler: the hand pans, the
   * blade cuts the item under the pointer. Returns true when it took the press.
   */
  const toolPress = (
    e: PointerEvent<HTMLElement>,
    target: Selection | null,
  ) => {
    if (e.button === 1 || (e.button === 0 && tool === "hand")) {
      panDrag(e);
      return true;
    }
    if (e.button === 0 && tool === "blade") {
      e.stopPropagation();
      const raw = toTime(e.clientX);
      const t = usePlayback.getState().snapping
        ? snapTime(raw, [usePlayback.getState().time], 6 / Math.max(pps, 1e-6))
        : raw;
      if (target && target.kind !== "clip")
        usePlayback.getState().select(target);
      editActions.splitAt(t, target && target.kind !== "clip" ? target : null);
      return true;
    }
    return false;
  };

  // --- Main track -------------------------------------------------------

  const dragClip = (p: Placed) => (e: PointerEvent<HTMLElement>) => {
    if (toolPress(e, { kind: "clip", id: p.clip.id })) return;
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

  const trimMain =
    (p: Placed, edge: "start" | "end") => (e: PointerEvent<HTMLElement>) => {
      if (tool !== "select") return;
      select({ kind: "clip", id: p.clip.id });
      const orig = useEdit.getState().edit.clips;
      const key = `clip-${edge}-${p.clip.id}-${Date.now()}`;
      startDrag(e, (dx) => {
        const dt = dx / pps;
        change(
          (ed) => ({
            ...ed,
            clips: trimClip(orig, p.clip.id, edge, dt, sourceDuration),
          }),
          key,
        );
      });
    };

  // --- Overlays and audio ----------------------------------------------

  type Free = Overlay | AudioClip;

  const dragFree =
    (
      kind: "overlay" | "audio",
      item: Free,
      mode: "move" | "start" | "end",
      lanes: number,
    ) =>
    (e: PointerEvent<HTMLElement>) => {
      if (toolPress(e, { kind, id: item.id })) return;
      select({ kind, id: item.id });
      const key = `${kind}-${mode}-${item.id}-${Date.now()}`;
      const field = kind === "overlay" ? "overlays" : "audio";
      // Overlay lanes stack upwards (lane 0 nearest the video), audio downwards.
      const laneDir = kind === "overlay" ? -1 : 1;
      const assetDuration =
        "asset" in item
          ? (useEdit.getState().edit.assets.find((a) => a.id === item.asset)
              ?.duration ?? null)
          : null;
      const hasIn = "in" in item;
      startDrag(e, (dx, dy) => {
        const dt = dx / pps;
        let patch: Partial<Free>;
        if (mode === "move") {
          const raw = Math.max(0, item.start + dt);
          const s1 = snap(raw, item.id);
          const s2 = snap(raw + item.duration, item.id) - item.duration;
          const start = Math.max(
            0,
            Math.abs(s1 - raw) <= Math.abs(s2 - raw) ? s1 : s2,
          );
          const lane = Math.max(
            0,
            Math.min(lanes, item.lane + Math.round((dy / LANE) * laneDir)),
          );
          patch = { start, lane };
        } else if (mode === "start") {
          const itemEnd = item.start + item.duration;
          const minStart = hasIn ? item.start - (item as { in: number }).in : 0;
          const start = Math.max(
            0,
            minStart,
            Math.min(snap(item.start + dt, item.id), itemEnd - MIN_ITEM),
          );
          patch = { start, duration: itemEnd - start };
          if (hasIn)
            (patch as { in: number }).in =
              (item as { in: number }).in + (start - item.start);
        } else {
          const maxDur =
            assetDuration !== null && hasIn
              ? assetDuration - (item as { in: number }).in
              : Infinity;
          const endT = snap(item.start + item.duration + dt, item.id);
          patch = {
            duration: Math.max(MIN_ITEM, Math.min(maxDur, endT - item.start)),
          };
        }
        change(
          (ed) => ({
            ...ed,
            [field]: (ed[field] as Free[]).map((o) =>
              o.id === item.id ? { ...o, ...patch } : o,
            ),
          }),
          key,
        );
      });
    };

  // --- Zooms (source time) ---------------------------------------------

  const dragZoom =
    (
      z: ZoomSegment,
      span: Placed<RecordingClip>,
      mode: "move" | "start" | "end",
    ) =>
    (e: PointerEvent<HTMLElement>) => {
      if (toolPress(e, null)) return;
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
          const next = constrainSegment(
            ed.zooms,
            z.id,
            raw.start,
            raw.end,
            sourceDuration,
            mode,
          );
          return {
            ...ed,
            zooms: ed.zooms.map((s) => (s.id === z.id ? { ...s, ...next } : s)),
          };
        }, key);
      });
    };

  const addZoomAt = (t: number) => {
    const s = sourceTimeAt(edit.clips, t);
    if (s === null) return;
    const slot = placeZoom(edit.zooms, s, sourceDuration);
    if (!slot) return;
    const id = newId("zoom");
    change((ed) => ({
      ...ed,
      zooms: [...ed.zooms, { id, ...slot, scale: 2, focus: null }],
    }));
    selectZoom(id);
  };
  const canZoomAt = (t: number) => {
    const s = sourceTimeAt(edit.clips, t);
    return s !== null && placeZoom(edit.zooms, s, sourceDuration) !== null;
  };

  // --- Track switches --------------------------------------------------

  const toggleLane = (field: "hidden" | "muted", lane: number) =>
    change((ed) => {
      const list = ed.tracks[field];
      const next = list.includes(lane)
        ? list.filter((l) => l !== lane)
        : [...list, lane];
      return { ...ed, tracks: { ...ed.tracks, [field]: next } };
    });

  const overlayLanes = edit.overlays.length
    ? Math.max(...edit.overlays.map((o) => o.lane)) + 1
    : 0;
  const audioLanes = edit.audio.length
    ? Math.max(...edit.audio.map((a) => a.lane)) + 1
    : 0;
  const isSel = (kind: Selection["kind"], id: string) =>
    selection?.kind === kind && selection.id === id;
  const assetName = (id: string) =>
    id === MIC_ASSET
      ? "Voice"
      : (edit.assets.find((a) => a.id === id)?.name ?? "Media");
  const trackWidth = x(end);

  const toolCursor =
    tool === "blade"
      ? "cursor-crosshair"
      : tool === "hand"
        ? "cursor-grab active:cursor-grabbing"
        : "";

  return (
    <div className="flex h-full min-h-0 select-none flex-col">
      <TimelineToolbar />
      <div
        ref={scrollRef}
        className={cn("relative min-h-0 flex-1 overflow-auto pb-3", toolCursor)}
        data-timeline-pps={pps}
        onWheel={onWheel}
        onPointerMove={(e) =>
          setBlade(tool === "blade" ? toTime(e.clientX) : null)
        }
        onPointerLeave={() => setBlade(null)}
        onPointerDown={(e) => {
          if (e.button === 1 || (e.button === 0 && tool === "hand")) {
            panDrag(e);
            return;
          }
          if (e.target === e.currentTarget) select(null);
        }}
      >
        <div
          className="relative"
          style={{ width: HEADER + trackWidth + GUTTER * 2 }}
        >
          {/* Ruler */}
          <Row header={<Timecode />} sticky height={28}>
            <div
              ref={contentRef}
              className="absolute inset-y-0 cursor-pointer"
              style={{ left: GUTTER, width: trackWidth }}
              onPointerDown={seekDrag}
            >
              {ticks.map((t) => {
                const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
                return (
                  <div
                    key={t}
                    className="absolute bottom-1 -translate-x-1/2"
                    style={{ left: x(t) }}
                  >
                    {major && t > 0 ? (
                      <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                        {formatTime(t)}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "size-[3px] rounded-full",
                        major
                          ? "bg-muted-foreground"
                          : "bg-muted-foreground/40",
                      )}
                    />
                  </div>
                );
              })}
              <PlayheadKnob x={x} />
            </div>
          </Row>

          {/* Overlay lanes, highest on top */}
          {Array.from(
            { length: overlayLanes },
            (_, i) => overlayLanes - 1 - i,
          ).map((lane) => {
            const hidden = edit.tracks.hidden.includes(lane);
            return (
              <Row
                key={`o${lane}`}
                height={LANE}
                header={
                  <TrackHeader
                    name={`T${lane + 1}`}
                    hint="Overlays"
                    color="bg-sky-500"
                    toggle={{
                      on: !hidden,
                      label: hidden ? "Show track" : "Hide track",
                      icon: hidden ? ViewOffSlashIcon : ViewIcon,
                      onClick: () => toggleLane("hidden", lane),
                    }}
                  />
                }
              >
                <Track width={trackWidth} dim={hidden}>
                  {edit.overlays
                    .filter((o) => o.lane === lane)
                    .map((o) => (
                      <TimelineItemMenu
                        key={o.id}
                        selection={{ kind: "overlay", id: o.id }}
                      >
                        <Block
                          left={x(o.start)}
                          width={x(o.duration)}
                          selected={isSel("overlay", o.id)}
                          className={OVERLAY_COLOR[o.kind]}
                          onPointerDown={dragFree(
                            "overlay",
                            o,
                            "move",
                            overlayLanes,
                          )}
                          onStart={dragFree(
                            "overlay",
                            o,
                            "start",
                            overlayLanes,
                          )}
                          onEnd={dragFree("overlay", o, "end", overlayLanes)}
                        >
                          {o.kind === "text"
                            ? o.text
                            : o.kind === "shape"
                              ? o.shape
                              : o.kind === "blur"
                                ? `Blur · ${o.mode}`
                                : assetName(o.asset)}
                        </Block>
                      </TimelineItemMenu>
                    ))}
                </Track>
              </Row>
            );
          })}

          {/* Main track */}
          <Row
            height={MAIN}
            header={<TrackHeader name="V1" hint="Video" color="bg-amber-500" />}
          >
            <Track width={trackWidth}>
              {placed.map((p) => (
                <TimelineItemMenu
                  key={p.clip.id}
                  selection={{ kind: "clip", id: p.clip.id }}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 flex flex-col items-center justify-center overflow-hidden rounded-lg border border-black/20 shadow-inner",
                      tool === "select" && "cursor-grab active:cursor-grabbing",
                      p.clip.kind === "recording"
                        ? "bg-gradient-to-b from-amber-500 to-amber-600 text-amber-950"
                        : "bg-gradient-to-b from-indigo-500 to-indigo-700 text-white",
                      isSel("clip", p.clip.id) &&
                        "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
                      moving?.id === p.clip.id && "z-10 opacity-80 shadow-xl",
                    )}
                    style={{
                      left: x(p.start),
                      width: Math.max(4, x(p.end - p.start)),
                      transform:
                        moving?.id === p.clip.id
                          ? `translateX(${moving.dx}px)`
                          : undefined,
                    }}
                    onPointerDown={dragClip(p)}
                  >
                    <ClipLabel clip={p.clip} />
                    <TrimHandle
                      side="start"
                      onPointerDown={trimMain(p, "start")}
                    />
                    <TrimHandle side="end" onPointerDown={trimMain(p, "end")} />
                  </div>
                </TimelineItemMenu>
              ))}
              {placed.slice(1).map((p, i) => (
                <TransitionMark
                  key={`tr-${p.clip.id}`}
                  left={x(p.start)}
                  width={x(transitionLength(placed[i].clip, p.clip))}
                  clip={p.clip}
                  onSelect={() => select({ kind: "clip", id: p.clip.id })}
                />
              ))}
              {taps.map((t, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: derived positions, no identity
                  key={i}
                  className="pointer-events-none absolute bottom-1 size-1.5 -translate-x-1/2 rounded-full bg-white/80"
                  style={{ left: x(t) }}
                />
              ))}
            </Track>
          </Row>

          {/* One track per recorded device */}
          {edit.layers && recordedLayers.length > 1
            ? edit.layers.map((le, i) => (
                <Row
                  key={`d-${le.instanceId}`}
                  height={DEVICE}
                  header={
                    <TrackHeader
                      name={`D${i + 1}`}
                      hint={registry.get(le.deviceId)?.name ?? le.deviceId}
                      color={DEVICE_COLORS[i % DEVICE_COLORS.length]}
                      toggle={{
                        on: !le.hidden,
                        label: le.hidden ? "Show device" : "Hide device",
                        icon: le.hidden ? ViewOffSlashIcon : ViewIcon,
                        onClick: () =>
                          editActions.setLayerHidden(le.instanceId, !le.hidden),
                      }}
                    />
                  }
                >
                  <Track width={trackWidth} dim={le.hidden}>
                    {spans.map((p) => (
                      <DeviceMenu
                        key={`${le.instanceId}-${p.clip.id}`}
                        instanceId={le.instanceId}
                      >
                        <div
                          className={cn(
                            "absolute inset-y-1 cursor-pointer rounded-md opacity-80 ring-1 ring-white/10 hover:opacity-100",
                            DEVICE_COLORS[i % DEVICE_COLORS.length],
                            selectedLayer === le.instanceId &&
                              "opacity-100 ring-2 ring-white/80",
                          )}
                          style={{
                            left: x(p.start),
                            width: Math.max(2, x(p.end - p.start)),
                          }}
                          onPointerDown={(e) => {
                            if (toolPress(e, { kind: "clip", id: p.clip.id }))
                              return;
                            usePlayback.getState().selectLayer(le.instanceId);
                            seekDrag(e);
                          }}
                        />
                      </DeviceMenu>
                    ))}
                  </Track>
                </Row>
              ))
            : null}

          {/* Zoom track */}
          <Row
            height={ZOOM}
            header={<TrackHeader name="Zoom" color="bg-violet-500" />}
          >
            <Track width={trackWidth}>
              <div
                className={cn(
                  "group/zooms absolute inset-0 rounded-lg",
                  tool === "select" && "cursor-copy",
                )}
                onPointerMove={(e) => setHover(toTime(e.clientX))}
                onPointerLeave={() => setHover(null)}
                onPointerDown={(e) => {
                  if (toolPress(e, null) || e.button !== 0) return;
                  selectZoom(null);
                  addZoomAt(toTime(e.clientX));
                }}
              >
                {edit.zooms.length === 0 && hover === null ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                    Click to add a zoom
                  </span>
                ) : null}
                {tool === "select" && hover !== null && canZoomAt(hover) ? (
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
                      "absolute inset-y-0 flex items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 text-[12px] text-white",
                      tool === "select" && "cursor-grab active:cursor-grabbing",
                      selectedZoom === z.id &&
                        "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
                    )}
                    style={{
                      left: x(start),
                      width: Math.max(4, x(zEnd - start)),
                    }}
                    onPointerDown={dragZoom(z, span, "move")}
                    onPointerMove={(e) => e.stopPropagation()}
                    onPointerEnter={() => setHover(null)}
                  >
                    <HugeiconsIcon
                      icon={Search01Icon}
                      size={12}
                      strokeWidth={2}
                    />
                    <span className="font-mono tabular-nums">
                      {z.scale.toFixed(1)}×
                    </span>
                    <span className="opacity-70">
                      {z.focus ? "Manual" : "Auto"}
                    </span>
                    <EdgeHandle
                      side="start"
                      onPointerDown={dragZoom(z, span, "start")}
                    />
                    <EdgeHandle
                      side="end"
                      onPointerDown={dragZoom(z, span, "end")}
                    />
                  </div>
                ))}
              </div>
            </Track>
          </Row>

          {/* Mic, under each recording clip */}
          {micUrl ? (
            <Row
              height={MIC}
              header={
                <TrackHeader
                  name="A1"
                  hint="Mic"
                  color="bg-emerald-500"
                  toggle={{
                    on: !edit.tracks.micMuted,
                    label: edit.tracks.micMuted ? "Unmute mic" : "Mute mic",
                    icon: edit.tracks.micMuted
                      ? VolumeMute01Icon
                      : VolumeHighIcon,
                    onClick: () =>
                      change((ed) => ({
                        ...ed,
                        tracks: { ...ed.tracks, micMuted: !ed.tracks.micMuted },
                      })),
                  }}
                />
              }
            >
              <Track width={trackWidth} dim={edit.tracks.micMuted}>
                {spans.map((p) => (
                  <div
                    key={`mic-${p.clip.id}`}
                    className={cn(
                      "absolute inset-y-0 overflow-hidden rounded-md bg-emerald-900/60 ring-1 ring-emerald-500/30",
                      p.clip.muted && "opacity-30",
                    )}
                    style={{
                      left: x(p.start),
                      width: Math.max(2, x(p.end - p.start)),
                    }}
                    onPointerDown={(e) =>
                      toolPress(e, { kind: "clip", id: p.clip.id }) ||
                      seekDrag(e)
                    }
                  >
                    <Waveform
                      url={micUrl}
                      from={p.clip.in - mediaOffset}
                      duration={p.end - p.start}
                      speed={p.clip.speed}
                      width={Math.max(2, x(p.end - p.start))}
                      height={MIC - 4}
                      color="rgba(110, 231, 183, 0.85)"
                    />
                  </div>
                ))}
              </Track>
            </Row>
          ) : null}

          {/* Music lanes */}
          {Array.from({ length: audioLanes }, (_, lane) => {
            const muted = edit.tracks.muted.includes(lane);
            return (
              <Row
                // biome-ignore lint/suspicious/noArrayIndexKey: the lane number is its identity
                key={`a${lane}`}
                height={LANE + 6}
                header={
                  <TrackHeader
                    name={`A${lane + (micUrl ? 2 : 1)}`}
                    hint="Music"
                    color="bg-teal-500"
                    toggle={{
                      on: !muted,
                      label: muted ? "Unmute track" : "Mute track",
                      icon: muted ? VolumeMute01Icon : VolumeHighIcon,
                      onClick: () => toggleLane("muted", lane),
                    }}
                  />
                }
              >
                <Track width={trackWidth} dim={muted}>
                  {edit.audio
                    .filter((a) => a.lane === lane)
                    .map((a) => (
                      <TimelineItemMenu
                        key={a.id}
                        selection={{ kind: "audio", id: a.id }}
                      >
                        <Block
                          left={x(a.start)}
                          width={x(a.duration)}
                          selected={isSel("audio", a.id)}
                          className="bg-teal-800/80 text-white ring-1 ring-teal-400/40"
                          onPointerDown={dragFree(
                            "audio",
                            a,
                            "move",
                            audioLanes,
                          )}
                          onStart={dragFree("audio", a, "start", audioLanes)}
                          onEnd={dragFree("audio", a, "end", audioLanes)}
                          background={
                            <Waveform
                              url={assetUrl(edit, a.asset)}
                              from={
                                a.asset === MIC_ASSET
                                  ? a.in - mediaOffset
                                  : a.in
                              }
                              duration={a.duration}
                              width={Math.max(6, x(a.duration))}
                              height={LANE + 2}
                              color="rgba(94, 234, 212, 0.75)"
                            />
                          }
                        >
                          ♪ {assetName(a.asset)}
                        </Block>
                      </TimelineItemMenu>
                    ))}
                </Track>
              </Row>
            );
          })}

          <Playhead x={(t) => HEADER + GUTTER + x(t)} />
          {blade !== null && tool === "blade" ? (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-[15] w-px bg-rose-400/80"
              style={{ left: HEADER + GUTTER + x(blade) }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const DEVICE = 22;
const DEVICE_COLORS = [
  "bg-cyan-500/70",
  "bg-fuchsia-500/70",
  "bg-lime-500/70",
  "bg-orange-500/70",
  "bg-blue-500/70",
];

const OVERLAY_COLOR: Record<Overlay["kind"], string> = {
  text: "bg-gradient-to-b from-sky-500 to-sky-700 text-white",
  image: "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white",
  video: "bg-gradient-to-b from-emerald-600 to-emerald-800 text-white",
  shape: "bg-gradient-to-b from-rose-500 to-rose-700 text-white",
  blur: "bg-[repeating-linear-gradient(45deg,rgba(148,163,184,0.55)_0_6px,rgba(100,116,139,0.55)_6px_12px)] text-white",
};

/** A track row: a header pinned on the left, then the track itself. */
function Row({
  header,
  height,
  sticky,
  children,
}: {
  header: ReactNode;
  height: number;
  sticky?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex",
        sticky ? "sticky top-0 z-30 bg-background" : "mt-1",
      )}
      style={{ height }}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center border-r border-white/5 bg-background pl-3"
        style={{ width: HEADER }}
      >
        {header}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function Track({
  width,
  dim,
  children,
}: {
  width: number;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 rounded-md bg-white/[0.025]",
        dim && "opacity-35",
      )}
      style={{ left: GUTTER, width }}
    >
      {children}
    </div>
  );
}

function TrackHeader({
  name,
  hint,
  color,
  toggle,
}: {
  name: string;
  hint?: string;
  color: string;
  toggle?: {
    on: boolean;
    label: string;
    icon: typeof ViewIcon;
    onClick: () => void;
  };
}) {
  return (
    <div className="flex w-full items-center gap-1.5 pr-1.5">
      <span className={cn("h-4 w-1 rounded-full", color)} />
      <span className="text-[11px] font-semibold">{name}</span>
      {hint ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {toggle ? (
        <button
          type="button"
          aria-label={toggle.label}
          title={toggle.label}
          onClick={toggle.onClick}
          className={cn(
            "ml-auto flex size-6 items-center justify-center rounded-md hover:bg-white/10",
            toggle.on ? "text-muted-foreground" : "text-rose-300",
          )}
        >
          <HugeiconsIcon icon={toggle.icon} size={13} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

/** The cut between two clips: a transition block, or a "+" to add one. */
function TransitionMark({
  left,
  width,
  clip,
  onSelect,
}: {
  left: number;
  width: number;
  clip: MainClip;
  onSelect: () => void;
}) {
  const label = TRANSITION_KINDS.find(
    (k) => k.id === clip.transition?.kind,
  )?.label;
  if (clip.transition && width > 0) {
    return (
      <button
        type="button"
        title={`${label} · ${clip.transition.duration.toFixed(1)}s`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onSelect}
        className="absolute top-1 bottom-1 z-10 overflow-hidden rounded-md border border-white/60 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.35)_0_4px,rgba(255,255,255,0.1)_4px_8px)] text-[9px] font-semibold text-white"
        style={{ left, width: Math.max(10, width) }}
      >
        <span className="truncate px-1">{width > 40 ? label : ""}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label="Add a transition"
      title="Add a transition"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        editActions.setTransition(clip.id, DEFAULT_TRANSITION);
        onSelect();
      }}
      className="absolute top-1/2 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 ring-1 ring-white/30 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
      style={{ left }}
    >
      <HugeiconsIcon icon={Add01Icon} size={10} strokeWidth={2.5} />
    </button>
  );
}

function ClipLabel({ clip }: { clip: MainClip }) {
  const seconds = clipDuration(clip).toFixed(1);
  if (clip.kind === "slide") {
    return (
      <>
        <span className="max-w-full truncate px-3 text-[11px] font-medium">
          {clip.title || "Slide"}
        </span>
        <span className="font-mono text-[11px] opacity-70 tabular-nums">
          {seconds}s
        </span>
      </>
    );
  }
  return (
    <>
      <span className="text-[10.5px] font-medium opacity-60">
        Clip{clip.speed !== 1 ? ` · ${clip.speed}×` : ""}
        {clip.muted ? " · muted" : ""}
      </span>
      <span className="font-mono text-[12px] font-semibold tabular-nums">
        {seconds}s
      </span>
    </>
  );
}

function Block({
  left,
  width,
  selected,
  className,
  children,
  background,
  onPointerDown,
  onStart,
  onEnd,
  ...rest
}: Omit<ComponentProps<"div">, "onPointerDown"> & {
  left: number;
  width: number;
  selected: boolean;
  className: string;
  children: ReactNode;
  background?: ReactNode;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onStart: (e: PointerEvent<HTMLElement>) => void;
  onEnd: (e: PointerEvent<HTMLElement>) => void;
}) {
  // `rest` carries what a context menu trigger injects (ref, onContextMenu).
  return (
    <div
      {...rest}
      className={cn(
        "absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2.5 text-[11px] font-medium",
        className,
        selected && "ring-2 ring-white/80 ring-offset-1 ring-offset-background",
      )}
      style={{ left, width: Math.max(6, width) }}
      onPointerDown={onPointerDown}
    >
      {background}
      <span className="relative truncate drop-shadow">{children}</span>
      <EdgeHandle side="start" onPointerDown={onStart} />
      <EdgeHandle side="end" onPointerDown={onEnd} />
    </div>
  );
}

function TrimHandle({
  side,
  onPointerDown,
}: {
  side: "start" | "end";
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
}) {
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

function EdgeHandle({
  side,
  onPointerDown,
}: {
  side: "start" | "end";
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-y-0 w-2 cursor-ew-resize hover:bg-white/25",
        side === "start" ? "left-0" : "right-0",
      )}
    />
  );
}

// Playhead parts subscribe to time on their own: playback only re-renders them.
// The line runs above clips but under the pinned headers and ruler.
function Playhead({ x }: { x: (t: number) => number }) {
  const time = usePlayback((s) => s.time);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-[15] w-px bg-violet-400"
      style={{ left: x(time) }}
    />
  );
}

function PlayheadKnob({ x }: { x: (t: number) => number }) {
  const time = usePlayback((s) => s.time);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 w-px bg-violet-400"
      style={{ left: x(time) }}
    >
      <div className="absolute bottom-0 left-1/2 h-3 w-2.5 -translate-x-1/2 rounded-b-sm bg-violet-400 [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]" />
    </div>
  );
}

function Timecode() {
  const time = usePlayback((s) => s.time);
  return (
    <span className="font-mono text-[11px] font-semibold text-violet-300 tabular-nums">
      {formatTime(time, true)}
    </span>
  );
}
