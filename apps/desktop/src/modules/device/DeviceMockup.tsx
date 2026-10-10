import { resolveScreenLayout } from "@goscreen/device-engine";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { AndroidScreen } from "@/modules/android/AndroidScreen";
import { registerFrame } from "@/modules/interaction/bridge";
import { useReload, useRuntime } from "@/modules/interaction/runtime";
import { registerGlass, registerScreen } from "@/modules/recording/stagePoint";
import { useRecording } from "@/modules/recording/store";
import type { ProjectDevice } from "@/modules/studio/store/project";
import { Cutout } from "./Cutout";
import { StatusBar } from "./StatusBar";
import { useDeviceContent } from "./useDeviceContent";

type Props = {
  instance: ProjectDevice;
  url: string;
  selected: boolean;
  // Iframes swallow pointer events, which breaks drags that cross them.
  framesInteractive: boolean;
  onFramePointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
};

// Renders one device at its natural frame size. Callers position it.
export function DeviceMockup({
  instance,
  url,
  selected,
  framesInteractive,
  onFramePointerDown,
}: Props) {
  const device = registry.get(instance.deviceId) ?? registry.list()[0];
  const live = instance.source.kind === "android" ? instance.source : null;
  const { src, bump } = useStableSource(instance.id, live ? "" : url);
  const content = useDeviceContent(src, device);
  const nonce = useReload((s) => s.nonce);
  // Hardware details are redrawn by the editor, so the model can change
  // after capture; they must not be burned into the recorded glass.
  const recording = useRecording((s) => s.active);

  const { frame, screen, bezel } = resolveScreenLayout(
    device,
    instance.orientation,
    instance.viewport,
  );
  const color =
    device.frame.colors.find((c) => c.id === instance.colorId) ??
    device.frame.colors[0];
  const portrait = instance.orientation === "portrait";
  const handheld = device.category === "phone" || device.category === "tablet";
  // A live Android screen draws its own status bar and navigation.
  const showStatusBar =
    !live &&
    handheld &&
    portrait &&
    instance.statusBar === "auto" &&
    device.statusBar.style !== "none";

  return (
    <div
      className="relative"
      style={{ width: frame.width, height: frame.height }}
    >
      {device.category === "phone" ? (
        <SideButtons portrait={portrait} color={color.edge} />
      ) : null}
      {device.category === "laptop" ? (
        <LaptopBase width={frame.width} body={color.body} edge={color.edge} />
      ) : null}
      {device.category === "desktop" ? (
        <MonitorStand width={frame.width} body={color.body} edge={color.edge} />
      ) : null}
      <div
        onPointerDown={onFramePointerDown}
        className={cn(
          "absolute inset-0",
          onFramePointerDown && "cursor-grab active:cursor-grabbing",
          selected && "outline-2 outline-offset-8 outline-signal",
        )}
        style={{
          borderRadius: handheld
            ? device.frame.radius
            : `${device.frame.radius}px ${device.frame.radius}px ${device.frame.radius / 3}px ${device.frame.radius / 3}px`,
          background: handheld
            ? `linear-gradient(145deg, ${color.edge}, ${color.body} 35%, ${color.body} 70%, ${color.edge})`
            : "#0b0b0c",
          boxShadow: `inset 0 0 0 ${handheld ? 1.5 : 3}px ${color.edge}, inset 0 0 0 ${Math.max(3, bezel * 0.3)}px ${handheld ? color.body : "#0b0b0c"}`,
        }}
      />
      <div
        ref={(el) => {
          registerGlass(instance.id, el);
          return () => registerGlass(instance.id, null);
        }}
        className="absolute overflow-hidden bg-black"
        style={{
          left: bezel,
          top: bezel,
          width: screen.width,
          height: screen.height,
          borderRadius: device.frame.screenRadius,
        }}
      >
        {recording ? null : (
          <Cutout cutout={device.cutout} orientation={instance.orientation} />
        )}
        <div className="flex h-full w-full flex-col bg-white">
          {showStatusBar ? (
            <StatusBar
              style={device.statusBar.style}
              height={device.safeArea.top}
            />
          ) : null}
          <div
            className="relative min-h-0 flex-1"
            ref={(el) => {
              registerScreen(instance.id, el);
              return () => registerScreen(instance.id, null);
            }}
          >
            <CornerMarkers />
            {live ? (
              <AndroidScreen
                instanceId={instance.id}
                serial={live.serial}
                interactive={framesInteractive}
              />
            ) : content.data ? (
              <iframe
                key={`${content.data.proxiedUrl}#${nonce}.${bump}`}
                ref={(el) => {
                  registerFrame(instance.id, el);
                  return () => registerFrame(instance.id, null);
                }}
                src={content.data.proxiedUrl}
                title={`${device.name} preview`}
                className={cn(
                  "h-full w-full border-0 bg-white",
                  !framesInteractive && "pointer-events-none",
                )}
                // No allow-top-navigation: a previewed page must never be able
                // to navigate the studio window itself.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                referrerPolicy="no-referrer"
              />
            ) : content.isError ? (
              <ScreenMessage error message={String(content.error)} />
            ) : (
              <ScreenMessage message="Loading" />
            )}
          </div>
        </div>
        {device.homeIndicator && portrait && !live && !recording ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-black/80"
          />
        ) : null}
      </div>
    </div>
  );
}

// When a synced device navigates by itself, the shared URL catches up to
// where it already is. Re-pointing its iframe would reload it for nothing.
function useStableSource(instanceId: string, url: string) {
  const [state, setState] = useState({ src: url, bump: 0 });
  const previous = useRef(url);
  useEffect(() => {
    if (url === previous.current) return;
    previous.current = url;
    const here = useRuntime.getState().locations[instanceId]?.href;
    if (url === here) return;
    // Same src but the page moved away from it: only a remount gets it back.
    setState((s) => ({ src: url, bump: s.src === url ? s.bump + 1 : s.bump }));
  }, [url, instanceId]);
  return state;
}

// Zero-size points at the screen corners; see recording/stagePoint.ts.
function CornerMarkers() {
  const base = "pointer-events-none absolute size-0";
  return (
    <>
      <span
        aria-hidden="true"
        data-corner="tl"
        className={cn(base, "top-0 left-0")}
      />
      <span
        aria-hidden="true"
        data-corner="tr"
        className={cn(base, "top-0 right-0")}
      />
      <span
        aria-hidden="true"
        data-corner="br"
        className={cn(base, "right-0 bottom-0")}
      />
      <span
        aria-hidden="true"
        data-corner="bl"
        className={cn(base, "bottom-0 left-0")}
      />
    </>
  );
}

function ScreenMessage({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-neutral-50 px-8 text-center text-neutral-500">
      {error ? (
        <HugeiconsIcon icon={Alert02Icon} size={28} strokeWidth={1.5} />
      ) : (
        <Spinner className="size-6" />
      )}
      <p className="text-[15px] leading-snug">{message}</p>
    </div>
  );
}

function LaptopBase({
  width,
  body,
  edge,
}: {
  width: number;
  body: string;
  edge: string;
}) {
  const overhang = width * 0.07;
  const height = Math.max(14, width * 0.018);
  return (
    <div
      aria-hidden="true"
      className="absolute"
      style={{
        top: "100%",
        left: -overhang,
        width: width + overhang * 2,
        height,
        borderRadius: `2px 2px ${height}px ${height}px`,
        background: `linear-gradient(180deg, ${edge}, ${body} 45%, ${body})`,
      }}
    >
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-md"
        style={{
          width: width * 0.14,
          height: height * 0.4,
          background: body,
          filter: "brightness(0.82)",
        }}
      />
    </div>
  );
}

function MonitorStand({
  width,
  body,
  edge,
}: {
  width: number;
  body: string;
  edge: string;
}) {
  const neckH = width * 0.12;
  return (
    <div
      aria-hidden="true"
      className="absolute left-1/2 -translate-x-1/2"
      style={{ top: "100%", width: width * 0.36 }}
    >
      <div
        className="mx-auto"
        style={{
          width: width * 0.16,
          height: neckH,
          background: `linear-gradient(90deg, ${body}, ${edge}, ${body})`,
        }}
      />
      <div
        style={{
          height: Math.max(10, width * 0.012),
          borderRadius: 6,
          background: `linear-gradient(180deg, ${edge}, ${body})`,
        }}
      />
    </div>
  );
}

function SideButtons({
  portrait,
  color,
}: {
  portrait: boolean;
  color: string;
}) {
  const style = { background: color };
  const v = "absolute w-[4px] rounded-sm";
  const h = "absolute h-[4px] rounded-sm";
  return portrait ? (
    <>
      <div
        className={cn(v, "-left-[3px] top-[180px] h-[34px]")}
        style={style}
      />
      <div
        className={cn(v, "-left-[3px] top-[240px] h-[64px]")}
        style={style}
      />
      <div
        className={cn(v, "-left-[3px] top-[320px] h-[64px]")}
        style={style}
      />
      <div
        className={cn(v, "-right-[3px] top-[260px] h-[100px]")}
        style={style}
      />
    </>
  ) : (
    <>
      <div
        className={cn(h, "-top-[3px] right-[180px] w-[34px]")}
        style={style}
      />
      <div
        className={cn(h, "-top-[3px] right-[240px] w-[64px]")}
        style={style}
      />
      <div
        className={cn(h, "-top-[3px] right-[320px] w-[64px]")}
        style={style}
      />
      <div
        className={cn(h, "-bottom-[3px] right-[260px] w-[100px]")}
        style={style}
      />
    </>
  );
}
