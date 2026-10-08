import type { CaptureMode } from "@goscreen/render-engine";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  GridViewIcon,
  Image01Icon,
  Mic01Icon,
  MicOff01Icon,
  RecordIcon,
  SmartPhone01Icon,
  Video01Icon,
  VideoOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useEditor } from "@/modules/studio/store/editor";
import { useProject } from "@/modules/studio/store/project";
import { useCaptureSettings } from "./settings";
import { useRecording } from "./store";
import type { CaptureControls } from "./useCapture";

const MODES: { id: CaptureMode; label: string; hint: string; icon: typeof Image01Icon }[] = [
  { id: "device", label: "Device", hint: "The selected device only, at full resolution", icon: SmartPhone01Icon },
  { id: "canvas", label: "Canvas", hint: "Every device visible on the canvas", icon: GridViewIcon },
  { id: "scene", label: "Scene", hint: "The devices placed in the scene", icon: Image01Icon },
];

const NONE = "none";

// Recording setup, Screen Studio style: what to capture, camera, microphone.
// Hidden during the take; Stop lives in the toolbar, outside the capture.
export function CaptureBar({ capture }: { capture: CaptureControls }) {
  const open = useCaptureSettings((s) => s.barOpen);
  const active = useRecording((s) => s.active);
  const { mode, camera, microphone, setMode, setCamera, setMicrophone, setBarOpen } = useCaptureSettings();
  const selectedId = useEditor((s) => s.selectedId);
  const selected = useProject((s) => s.devices.find((d) => d.id === selectedId));
  const hasDevices = useProject((s) => s.devices.length > 0);
  const devices = useQuery({ queryKey: ["capture-devices"], queryFn: ipc.captureDevices, enabled: open, staleTime: 15_000 });

  if (!open || active) return null;

  const cameraName = devices.data?.cameras.find((c) => c.index === camera)?.name;
  const micName = devices.data?.microphones.find((m) => m.index === microphone)?.name;
  const blocked = !hasDevices || (mode === "device" && !selected);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/90 p-1.5 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          aria-label="Close"
          onClick={() => setBarOpen(false)}
          className="mx-1 flex size-8 items-center justify-center rounded-full bg-white text-neutral-900 hover:bg-white/90"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2.5} />
        </button>
        <Divider />
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex w-[70px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/5 hover:text-white",
              mode === m.id && "bg-white/10 text-white",
            )}
          >
            <HugeiconsIcon icon={m.icon} size={20} strokeWidth={1.6} />
            {m.label}
          </button>
        ))}
        <Divider />
        <DeviceMenu
          label={cameraName ?? "No camera"}
          icon={camera === null ? VideoOffIcon : Video01Icon}
          title="Camera"
          loading={devices.isPending}
          value={camera}
          options={devices.data?.cameras ?? []}
          onChange={setCamera}
        />
        <DeviceMenu
          label={micName ?? "No microphone"}
          icon={microphone === null ? MicOff01Icon : Mic01Icon}
          title="Microphone"
          loading={devices.isPending}
          value={microphone}
          options={devices.data?.microphones ?? []}
          onChange={setMicrophone}
        />
        <Divider />
        <Button
          onClick={capture.toggleRecording}
          disabled={blocked || capture.isStarting}
          title={blocked ? (hasDevices ? "Select a device first" : "Add a device first") : "Start recording (⇧⌘R)"}
          className="mx-1 h-10 gap-2 rounded-xl bg-rec px-4 text-white hover:bg-rec/90"
        >
          {capture.isStarting ? <Spinner /> : <HugeiconsIcon icon={RecordIcon} strokeWidth={2} />}
          Record
        </Button>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-8 w-px bg-white/10" />;
}

function DeviceMenu({
  label,
  icon,
  title,
  loading,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof Video01Icon;
  title: string;
  loading: boolean;
  value: number | null;
  options: { index: number; name: string }[];
  onChange: (v: number | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-12 max-w-[190px] items-center gap-2 rounded-xl px-3 text-[13px] hover:bg-white/5",
            value === null ? "text-white/60" : "text-white",
          )}
        >
          <HugeiconsIcon icon={icon} size={18} strokeWidth={1.6} className="shrink-0" />
          <span className="truncate">{label}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-64">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Looking for devices…
          </div>
        ) : (
          <DropdownMenuRadioGroup
            value={value === null ? NONE : String(value)}
            onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
          >
            <DropdownMenuRadioItem value={NONE}>None</DropdownMenuRadioItem>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.index} value={String(o.index)}>
                {o.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
