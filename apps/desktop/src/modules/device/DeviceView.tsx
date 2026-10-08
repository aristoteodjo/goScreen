import {
  type DeviceInstance,
  instanceTransform,
  resolveScreenLayout,
  shadowToCss,
} from "@goscreen/device-engine";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PointerEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { registerFrame } from "@/modules/interaction/bridge";
import { useReload } from "@/modules/interaction/runtime";
import { Cutout } from "./Cutout";
import { StatusBar } from "./StatusBar";
import { useDeviceContent } from "./useDeviceContent";

type Props = {
  instance: DeviceInstance;
  url: string;
  selected: boolean;
  // Iframes swallow pointer events, which breaks dragging across them.
  framesInteractive: boolean;
  onFramePointerDown: (e: PointerEvent<HTMLDivElement>) => void;
};

export function DeviceView({ instance, url, selected, framesInteractive, onFramePointerDown }: Props) {
  const device = registry.get(instance.deviceId);
  const content = useDeviceContent(url, device ?? registry.list()[0]);
  const nonce = useReload((s) => s.nonce);
  if (!device) return null;

  const { frame, screen, bezel } = resolveScreenLayout(device, instance.orientation);
  const color = device.frame.colors.find((c) => c.id === instance.colorId) ?? device.frame.colors[0];
  const portrait = instance.orientation === "portrait";
  const showStatusBar = portrait && instance.statusBar === "auto" && device.statusBar.style !== "none";
  const statusHeight = showStatusBar ? device.safeArea.top : 0;
  const isPhone = device.category === "phone";

  return (
    <div
      className="absolute top-0 left-0 will-change-transform"
      style={{
        width: frame.width,
        height: frame.height,
        transform: instanceTransform(instance),
        filter: instance.renderMode === "flat" ? undefined : shadowToCss(instance.shadow),
      }}
    >
      {isPhone ? <SideButtons portrait={portrait} color={color.edge} /> : null}
      <div
        onPointerDown={onFramePointerDown}
        className={cn(
          "absolute inset-0 cursor-grab active:cursor-grabbing",
          selected && "outline-2 outline-offset-8 outline-signal",
        )}
        style={{
          borderRadius: device.frame.radius,
          background: `linear-gradient(145deg, ${color.edge}, ${color.body} 35%, ${color.body} 70%, ${color.edge})`,
          boxShadow: `inset 0 0 0 1.5px ${color.edge}, inset 0 0 0 ${Math.max(3, bezel * 0.3)}px ${color.body}`,
        }}
      />
      <div
        className="absolute overflow-hidden bg-black"
        style={{
          left: bezel,
          top: bezel,
          width: screen.width,
          height: screen.height,
          borderRadius: device.frame.screenRadius,
        }}
      >
        <Cutout cutout={device.cutout} orientation={instance.orientation} />
        <div className="flex h-full w-full flex-col bg-white">
          {showStatusBar ? <StatusBar style={device.statusBar.style} height={statusHeight} /> : null}
          <div className="relative min-h-0 flex-1">
            {content.data ? (
              <iframe
                key={`${content.data.proxiedUrl}#${nonce}`}
                ref={(el) => {
                  registerFrame(instance.id, el);
                  return () => registerFrame(instance.id, null);
                }}
                src={content.data.proxiedUrl}
                title={`${device.name} preview`}
                className={cn("h-full w-full border-0 bg-white", !framesInteractive && "pointer-events-none")}
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
        {device.homeIndicator && portrait ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-black/80"
          />
        ) : null}
      </div>
    </div>
  );
}

function ScreenMessage({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-neutral-50 px-8 text-center text-neutral-500">
      {error ? <HugeiconsIcon icon={Alert02Icon} size={28} strokeWidth={1.5} /> : <Spinner className="size-6" />}
      <p className="text-[15px] leading-snug">{message}</p>
    </div>
  );
}

function SideButtons({ portrait, color }: { portrait: boolean; color: string }) {
  const style = { background: color };
  const v = "absolute w-[4px] rounded-sm";
  const h = "absolute h-[4px] rounded-sm";
  return portrait ? (
    <>
      <div className={cn(v, "-left-[3px] top-[180px] h-[34px]")} style={style} />
      <div className={cn(v, "-left-[3px] top-[240px] h-[64px]")} style={style} />
      <div className={cn(v, "-left-[3px] top-[320px] h-[64px]")} style={style} />
      <div className={cn(v, "-right-[3px] top-[260px] h-[100px]")} style={style} />
    </>
  ) : (
    <>
      <div className={cn(h, "-top-[3px] right-[180px] w-[34px]")} style={style} />
      <div className={cn(h, "-top-[3px] right-[240px] w-[64px]")} style={style} />
      <div className={cn(h, "-top-[3px] right-[320px] w-[64px]")} style={style} />
      <div className={cn(h, "-bottom-[3px] right-[260px] w-[100px]")} style={style} />
    </>
  );
}
