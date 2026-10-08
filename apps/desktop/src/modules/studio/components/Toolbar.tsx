import { Camera01Icon, Globe02Icon, RecordIcon, RefreshIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { useReload } from "@/modules/interaction/runtime";
import type { CaptureControls } from "@/modules/recording/useCapture";
import { useCaptureSettings } from "@/modules/recording/settings";
import { useRecording } from "@/modules/recording/store";
import { ASPECTS, type AspectId } from "../store/aspect";
import { type ViewMode, useEditor } from "../store/editor";
import { useProject } from "../store/project";

export function Toolbar({ capture }: { capture: CaptureControls }) {
  const sharedUrl = useProject((s) => s.url);
  const setUrl = useProject((s) => s.setUrl);
  const navigateDevice = useProject((s) => s.navigateDevice);
  const selectedId = useEditor((s) => s.selectedId);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  // An unsynced selected device has its own address; edit that one.
  const ownDevice = useProject((s) =>
    s.devices.find((d) => d.id === selectedId && !d.synced && d.source.kind === "web"),
  );
  const url = ownDevice ? (ownDevice.url ?? sharedUrl) : sharedUrl;
  const aspect = useProject((s) => s.aspect);
  const setAspect = useProject((s) => s.setAspect);
  const allSynced = useProject((s) => {
    const web = s.devices.filter((d) => d.source.kind === "web");
    return web.length > 0 && web.every((d) => d.synced);
  });
  const setAllSynced = useProject((s) => s.setAllSynced);
  const reloadAll = useReload((s) => s.reloadAll);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(url);

  useEffect(() => setDraft(url), [url]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = normalizeUrl(draft);
    if (!next) {
      toast.error("Enter a valid http or https address.");
      return;
    }
    if (next === url) reload();
    else if (ownDevice) navigateDevice(ownDevice.id, next);
    else setUrl(next);
  };

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["proxy"] });
    reloadAll();
  };

  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(v) => v && setView(v as ViewMode)}
      >
        <ToggleGroupItem value="canvas" className="px-3 text-xs">Canvas</ToggleGroupItem>
        <ToggleGroupItem value="scene" className="px-3 text-xs">Scene</ToggleGroupItem>
      </ToggleGroup>
      <form onSubmit={submit} className="mx-auto w-full max-w-xl">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <HugeiconsIcon icon={Globe02Icon} strokeWidth={1.75} />
          </InputGroupAddon>
          <InputGroupInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={ownDevice ? "Address for this device only" : "https://your-site.com or localhost:3000"}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="font-mono text-xs"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" type="button" onClick={reload} aria-label="Reload all devices">
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.75} />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch size="sm" checked={allSynced} onCheckedChange={setAllSynced} />
              Sync all
            </Label>
          </TooltipTrigger>
          <TooltipContent>Shared URL and scroll for every device. Fine-tune per device on each frame.</TooltipContent>
        </Tooltip>
        {view === "scene" ? (
        <Select value={aspect} onValueChange={(v) => setAspect(v as AspectId)}>
          <SelectTrigger size="sm" className="w-[84px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(ASPECTS).map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={capture.screenshot}
              disabled={capture.isShooting || capture.recording}
              aria-label="Screenshot"
            >
              {capture.isShooting ? <Spinner /> : <HugeiconsIcon icon={Camera01Icon} strokeWidth={1.75} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Screenshot</TooltipContent>
        </Tooltip>
        <RecordButton capture={capture} />
      </div>
    </header>
  );
}

function RecordButton({ capture }: { capture: CaptureControls }) {
  const startedAt = useRecording((s) => s.startedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt]);

  const busy = capture.isStarting || capture.isStopping;
  const barOpen = useCaptureSettings((s) => s.barOpen);
  const setBarOpen = useCaptureSettings((s) => s.setBarOpen);
  // Record opens the capture bar; while recording this is the Stop button,
  // kept in the toolbar so it is never inside the captured area.
  const onClick = () => (capture.recording ? capture.toggleRecording() : setBarOpen(!barOpen));
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const label = capture.recording
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
    : "Record";

  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "min-w-[92px] gap-1.5 tabular-nums",
        capture.recording ? "bg-rec text-white hover:bg-rec/90" : "bg-signal text-signal-foreground hover:bg-signal/90",
      )}
    >
      {busy ? (
        <Spinner />
      ) : (
        <HugeiconsIcon icon={capture.recording ? StopIcon : RecordIcon} strokeWidth={2} />
      )}
      {label}
    </Button>
  );
}
