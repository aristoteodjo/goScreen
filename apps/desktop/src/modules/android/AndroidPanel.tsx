import {
  type AndroidDevice,
  describeAndroidError,
  suggestProfile,
  toAndroidError,
} from "@goscreen/android-source";
import { viewportFor } from "@goscreen/content-source";
import { Settings02Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { registry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { canvasCommands } from "@/modules/canvas/commands";
import { useEditor } from "@/modules/studio/store/editor";
import { useProject } from "@/modules/studio/store/project";
import { useAndroidSettings } from "./provider";
import { useAdbStatus, useAndroidDevices } from "./useAndroid";

// "Add Device > Sources > Android": running emulators and USB devices.
export function AndroidPanel() {
  const status = useAdbStatus();
  const devices = useAndroidDevices();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Android</SidebarGroupLabel>
      <AdbPathAction />
      <SidebarGroupContent className="flex flex-col gap-1.5 px-2">
        {status.isPending ? (
          <Hint>Looking for ADB…</Hint>
        ) : status.isError ? (
          <Problem error={status.error} />
        ) : !status.data.available ? (
          <Problem
            error={toAndroidError({ code: "adb_missing", detail: "" })}
          />
        ) : devices.isError ? (
          <Problem error={devices.error} />
        ) : devices.data === undefined ? (
          <Hint>
            <Spinner className="size-3" /> Detecting devices…
          </Hint>
        ) : devices.data.length === 0 ? (
          <Hint>
            No emulator or device detected. Start one from Android Studio.
          </Hint>
        ) : (
          devices.data.map((d) => <DeviceCard key={d.serial} device={d} />)
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Problem({ error }: { error: unknown }) {
  const info = describeAndroidError(toAndroidError(error).code);
  return (
    <div className="rounded-md border border-dashed px-2.5 py-2 text-xs">
      <p className="text-foreground">{info.title}</p>
      {info.hints.map((h) => (
        <p key={h} className="mt-1 text-muted-foreground">
          {h}
        </p>
      ))}
    </div>
  );
}

function DeviceCard({ device }: { device: AndroidDevice }) {
  const inScene = useProject((s) =>
    s.devices.find(
      (d) => d.source.kind === "android" && d.source.serial === device.serial,
    ),
  );
  const select = useEditor((s) => s.select);
  const ready = device.state === "device";

  const connect = () => {
    if (inScene) {
      select(inScene.id);
      if (useEditor.getState().view === "canvas")
        canvasCommands.focus(inScene.id);
      return;
    }
    const profile = suggestProfile(device, registry.list());
    if (!profile) return;
    const id = useProject.getState().addDevice(profile, {
      source: { kind: "android", serial: device.serial },
      viewport: device.resolution
        ? viewportFor({ ...device.resolution, density: device.density })
        : null,
      orientation: device.orientation,
    });
    if (!id) return;
    select(id);
    if (useEditor.getState().view === "canvas")
      requestAnimationFrame(() => canvasCommands.focus(id));
  };

  return (
    <div className="rounded-md border bg-background/40 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            ready ? "bg-emerald-400" : "bg-amber-400",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{device.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {device.serial}
          </p>
          {device.resolution ? (
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {device.resolution.width} × {device.resolution.height}
              {device.androidVersion
                ? ` · Android ${device.androidVersion}`
                : ""}
            </p>
          ) : null}
        </div>
      </div>
      {ready ? (
        <Button
          size="sm"
          variant={inScene ? "ghost" : "secondary"}
          className="mt-2 h-7 w-full gap-1.5 text-xs"
          onClick={connect}
        >
          <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={1.75} />
          {inScene ? "Show in scene" : "Connect"}
        </Button>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {
            describeAndroidError(
              device.state === "device" ? "unknown" : device.state,
            ).hints[0]
          }
        </p>
      )}
    </div>
  );
}

function AdbPathAction() {
  const adbPath = useAndroidSettings((s) => s.adbPath);
  const setAdbPath = useAndroidSettings((s) => s.setAdbPath);
  const status = useAdbStatus();
  const [draft, setDraft] = useState(adbPath ?? "");

  return (
    <Popover onOpenChange={(open) => open && setDraft(adbPath ?? "")}>
      <PopoverTrigger asChild>
        <SidebarGroupAction aria-label="ADB settings">
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.75} />
        </SidebarGroupAction>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-80 space-y-3 text-xs"
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">ADB location</p>
          <p className="text-muted-foreground">
            Detected automatically from ANDROID_HOME, PATH and the default SDK
            folder. Set a path only if detection fails.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAdbPath(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="~/Library/Android/sdk/platform-tools/adb"
            spellCheck={false}
            className="h-8 font-mono text-[11px]"
          />
          <Button type="submit" size="sm" className="h-8">
            Save
          </Button>
        </form>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {status.data?.path ? `Using ${status.data.path}` : "No adb in use"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
