import { type CameraShape, nearestCorner, type Rect, webcamRect } from "@goscreen/render-engine";
import { useQuery } from "@tanstack/react-query";
import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCaptureSettings } from "./settings";
import { screenElements } from "./stagePoint";
import { useRecording } from "./store";

const SIZES = [
  { label: "Small", value: 0.16 },
  { label: "Medium", value: 0.22 },
  { label: "Large", value: 0.32 },
];

const SHAPES: { id: CameraShape; label: string }[] = [
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
];

/**
 * The browser sees cameras by label, FFmpeg by avfoundation index: both
 * name the same AVCaptureDevice, so the label is the bridge.
 */
function useCameraStream(name: string | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!name || !navigator.mediaDevices?.getUserMedia) return;
    let alive = true;
    let current: MediaStream | null = null;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const match = devices.find((d) => d.kind === "videoinput" && d.label === name);
        const video = match ? { deviceId: { exact: match.deviceId } } : true;
        current = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        if (alive) setStream(current);
        else for (const t of current.getTracks()) t.stop();
      } catch {
        if (alive) setStream(null);
      }
    })();
    return () => {
      alive = false;
      if (current) for (const t of current.getTracks()) t.stop();
      setStream(null);
    };
  }, [name]);
  return stream;
}

const overlaps = (a: Rect, b: DOMRect) =>
  a.x < b.right && a.x + a.width > b.left && a.y < b.bottom && a.y + a.height > b.top;

/**
 * Live webcam bubble over the canvas or the scene, placed like the editor
 * overlay: what you set here is how the recording opens in the editor.
 * The camera is recorded on its own file, so the bubble must never be
 * burned into a device screen: it hides during a take when it overlaps one.
 */
export function LiveCamera() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [overGlass, setOverGlass] = useState(false);
  const cameraIndex = useCaptureSettings((s) => s.camera);
  const bubble = useCaptureSettings((s) => s.bubble);
  const setBubble = useCaptureSettings((s) => s.setBubble);
  const recording = useRecording((s) => s.active);
  const devices = useQuery({
    queryKey: ["capture-devices"],
    queryFn: ipc.captureDevices,
    enabled: cameraIndex !== null,
    staleTime: 15_000,
  });
  const name = devices.data?.cameras.find((c) => c.index === cameraIndex)?.name ?? null;
  const shown = cameraIndex !== null && bubble.visible;
  const stream = useCameraStream(shown ? name : null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rect = box.width > 0 ? webcamRect(box, { ...bubble, layout: "overlay" }, true) : null;

  // Device screens are fixed for the whole take: checked when it starts.
  useEffect(() => {
    const host = hostRef.current;
    const r = box.width > 0 ? webcamRect(box, { ...bubble, layout: "overlay" }, true) : null;
    if (!recording || !r || !host) {
      setOverGlass(false);
      return;
    }
    const origin = host.getBoundingClientRect();
    const onScreen = { ...r, x: r.x + origin.left, y: r.y + origin.top };
    setOverGlass([...screenElements().values()].some((el) => overlaps(onScreen, el.getBoundingClientRect())));
  }, [recording, box, bubble]);

  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current?.getBoundingClientRect();
    if (e.button !== 0 || recording || !rect || !host) return;
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // Offset of the pointer inside the bubble, in host coordinates.
    const grab = { x: e.clientX - host.left - rect.x, y: e.clientY - host.top - rect.y };
    const at = (ev: globalThis.PointerEvent) => ({ x: ev.clientX - host.left - grab.x, y: ev.clientY - host.top - grab.y });
    const onMove = (ev: globalThis.PointerEvent) => setDrag(at(ev));
    const onUp = (ev: globalThis.PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      const p = at(ev);
      const center = { x: p.x + rect.width / 2, y: p.y + rect.height / 2 };
      setBubble({ corner: nearestCorner(box, bubble, center) });
      setDrag(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp, { once: true });
    el.addEventListener("pointercancel", () => setDrag(null), { once: true });
  };

  const visible = shown && rect && !(recording && overGlass);
  const radius = bubble.shape === "circle" ? "50%" : bubble.shape === "rounded" ? "18%" : "6px";

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {visible ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onPointerDown={startDrag}
              className={cn(
                "pointer-events-auto absolute overflow-hidden bg-neutral-900 shadow-2xl ring-1 ring-white/15",
                !recording && "cursor-grab active:cursor-grabbing",
                drag === null && "transition-[left,top,width,height] duration-200 ease-out",
              )}
              style={{
                left: drag?.x ?? rect.x,
                top: drag?.y ?? rect.y,
                width: rect.width,
                height: rect.height,
                borderRadius: radius,
              }}
            >
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                className="size-full object-cover"
                style={{ transform: bubble.mirror ? "scaleX(-1)" : undefined }}
              />
              {stream ? null : (
                <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-white/60">
                  {name ? "Starting camera…" : "Camera unavailable"}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuLabel>Camera bubble</ContextMenuLabel>
            <ContextMenuRadioGroup value={String(bubble.size)} onValueChange={(v) => setBubble({ size: Number(v) })}>
              {SIZES.map((s) => (
                <ContextMenuRadioItem key={s.value} value={String(s.value)}>
                  {s.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup value={bubble.shape} onValueChange={(v) => setBubble({ shape: v as CameraShape })}>
              {SHAPES.map((s) => (
                <ContextMenuRadioItem key={s.id} value={s.id}>
                  {s.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem checked={bubble.mirror} onCheckedChange={(v) => setBubble({ mirror: v === true })}>
              Mirror
            </ContextMenuCheckboxItem>
            <ContextMenuItem onSelect={() => setBubble({ visible: false })}>Hide bubble</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : null}
    </div>
  );
}
