import { fitScale, instanceTransform, shadowToCss } from "@goscreen/device-engine";
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { DeviceMockup } from "@/modules/device/DeviceMockup";
import { useRecording } from "@/modules/recording/store";
import { setStageElement } from "../stageRef";
import { ASPECTS } from "../store/aspect";
import { backgroundToCss } from "../store/backgrounds";
import { useEditor } from "../store/editor";
import { deviceUrl, useProject } from "../store/project";

type Drag = { id: string; startX: number; startY: number; originX: number; originY: number };

export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);

  const devices = useProject((s) => s.devices);
  const url = useProject((s) => s.url);
  const aspect = useProject((s) => s.aspect);
  const background = useProject((s) => s.background);
  const updateDevice = useProject((s) => s.updateDevice);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const recording = useRecording((s) => s.active);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stage = ASPECTS[aspect];
  const zoom = box.width > 0 ? fitScale(stage, box, 32) : 0;

  const onFramePointerDown = (id: string) => (e: PointerEvent<HTMLDivElement>) => {
    if (recording || e.button !== 0) return;
    e.stopPropagation();
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    select(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, startX: e.clientX, startY: e.clientY, originX: d.x, originY: d.y });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || zoom === 0) return;
    updateDevice(drag.id, {
      x: Math.round(drag.originX + (e.clientX - drag.startX) / zoom),
      y: Math.round(drag.originY + (e.clientY - drag.startY) / zoom),
    });
  };

  return (
    <div
      ref={hostRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-stage"
      onPointerDown={() => !recording && select(null)}
    >
      {zoom > 0 ? (
        <div
          ref={setStageElement}
          className="relative shrink-0 overflow-hidden"
          style={{
            width: stage.width * zoom,
            height: stage.height * zoom,
            background: backgroundToCss(background),
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: stage.width, height: stage.height, transform: `scale(${zoom})` }}
          >
            {devices.map((d) => (
              <div
                key={d.id}
                className="absolute top-0 left-0 will-change-transform"
                style={{
                  transform: instanceTransform(d),
                  filter: d.renderMode === "flat" ? undefined : shadowToCss(d.shadow),
                }}
              >
                <DeviceMockup
                  instance={d}
                  url={deviceUrl(d, url)}
                  selected={!recording && d.id === selectedId}
                  framesInteractive={drag === null}
                  onFramePointerDown={onFramePointerDown(d.id)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {devices.length === 0 ? <EmptyStage /> : null}
    </div>
  );
}

function EmptyStage() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="rounded-xl border border-white/10 bg-black/40 px-5 py-4 text-center backdrop-blur">
        <p className="text-sm font-medium text-white">Add a device to start</p>
        <p className="mt-1 text-xs text-white/60">Pick one in the left panel, or press Cmd K.</p>
      </div>
    </div>
  );
}
