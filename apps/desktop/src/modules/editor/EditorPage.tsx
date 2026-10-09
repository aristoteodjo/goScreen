import {
  ASPECT_OPTIONS,
  type AspectId,
  buildAutoZooms,
  DEFAULT_EDIT,
  EMPTY_RECORDING,
  type EditState,
  formatTime,
  outputSize,
  parseEditState,
  parseRecordingFile,
  type RecordingFile,
  stageArea,
} from "@goscreen/render-engine";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RedoIcon,
  SquareArrowExpand01Icon,
  UndoIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc } from "@/lib/ipc";
import { EditorPalette } from "./EditorPalette";
import { initialLayers } from "./devices";
import { ExportDialog } from "./ExportDialog";
import { PanelContent, PanelRail } from "./Panels";
import { Preview } from "./Preview";
import { player, requestPaint, useSession } from "./session";
import { type Quality, trimEnd, useEdit, usePlayback } from "./store";
import { Timeline } from "./Timeline";
import { useEditorShortcuts } from "./useEditorShortcuts";

const SAVE_DELAY = 800;

export function EditorPage({ video }: { video: string }) {
  const [exporting, setExporting] = useState(false);
  const openExport = useCallback(() => setExporting(true), []);
  const recording = useQuery({
    queryKey: ["recording", video],
    queryFn: () => ipc.recordingOpen(video),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  // Auto zooms are only suggested for a recording opened for the first time.
  const needsAutoZoom = useRef(false);

  useEffect(() => {
    const data = recording.data;
    if (!data) return;
    let file: RecordingFile = EMPTY_RECORDING;
    try {
      if (data.interactions) file = parseRecordingFile(data.interactions);
    } catch {
      toast.warning("Interactions could not be read; touches and auto zoom are off.");
    }
    const saved = data.edit ? parseEditState(data.edit) : null;
    needsAutoZoom.current = saved === null;
    usePlayback.getState().reset();
    useSession.getState().open({
      videoPath: data.videoPath,
      name: data.name,
      videoUrl: data.videoUrl,
      cameraUrl: data.cameraUrl,
      micUrl: data.micUrl,
      pointers: file.pointers,
      layers: file.layers,
      mediaOffset: file.mediaOffset,
    });
    useEdit.getState().load(saved ?? { ...DEFAULT_EDIT, camera: file.camera ?? DEFAULT_EDIT.camera });
    if (file.layers.length > 0) usePlayback.getState().setPanel("devices");
  }, [recording.data]);

  // The preview hears the mic at its edited level (elements cap at 100%).
  useEffect(
    () =>
      useEdit.subscribe((s) => {
        const mic = useSession.getState().mic;
        if (mic) mic.volume = Math.min(1, s.edit.mic.volume);
      }),
    [],
  );

  useAutosave(recording.data?.videoPath ?? null);
  useEditorShortcuts(openExport);

  useEffect(
    () => () => {
      player.pause();
      useSession.getState().setVideo(null);
      useSession.getState().setCamera(null);
      useSession.getState().setMic(null);
    },
    [],
  );

  const onMetadata = (el: HTMLVideoElement) => {
    const source = { width: el.videoWidth, height: el.videoHeight };
    useSession.getState().setSource(source);
    usePlayback.getState().setDuration(el.duration);
    if (needsAutoZoom.current) {
      needsAutoZoom.current = false;
      const { pointers, layers, cameraUrl } = useSession.getState();
      const edit = useEdit.getState().edit;
      const zooms = buildAutoZooms(pointers, el.duration);
      // A fresh layered recording starts with its devices side by side.
      const area = stageArea(outputSize(edit.aspect, source), edit.camera, cameraUrl !== null);
      const placed = layers.length > 0 ? initialLayers(layers, area) : null;
      useEdit.getState().load({ ...edit, zooms, layers: placed });
    }
    player.seek(useEdit.getState().edit.trim.start);
  };

  return (
    <div className="flex h-full flex-col bg-[oklch(0.13_0.004_260)]">
      <TopBar name={recording.data?.name ?? ""} onExport={openExport} />
      {recording.isError ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {String(recording.error)}
        </div>
      ) : recording.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : (
        <>
          <video
            ref={(el) => {
              useSession.getState().setVideo(el);
            }}
            src={recording.data.videoUrl}
            crossOrigin="anonymous"
            preload="auto"
            muted
            playsInline
            onLoadedMetadata={(e) => onMetadata(e.currentTarget)}
            onLoadedData={requestPaint}
            onSeeked={requestPaint}
            onError={() => toast.error("The recording could not be decoded.")}
            // Not display:none: WebKit stops decoding frames of hidden videos.
            className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
          />
          {recording.data.cameraUrl ? (
            <video
              ref={(el) => {
                useSession.getState().setCamera(el);
              }}
              src={recording.data.cameraUrl}
              crossOrigin="anonymous"
              preload="auto"
              muted
              playsInline
              onLoadedData={requestPaint}
              onSeeked={requestPaint}
              className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
            />
          ) : null}
          {recording.data.micUrl ? (
            <audio
              ref={(el) => {
                useSession.getState().setMic(el);
              }}
              src={recording.data.micUrl}
              preload="auto"
            >
              {/* Narration of the user's own recording; no caption track exists. */}
              <track kind="captions" />
            </audio>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-3 px-4 pt-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <PreviewHeader />
              <Preview />
            </div>
            <PanelRail />
            <PanelContent />
          </div>
          <Transport />
          <Timeline />
        </>
      )}
      <ExportDialog open={exporting} onOpenChange={setExporting} />
      <EditorPalette openExport={openExport} />
    </div>
  );
}

function useAutosave(videoPath: string | null) {
  useEffect(() => {
    if (!videoPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warned = false;
    const save = (edit: EditState) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        ipc.editSave(videoPath, edit).catch((e) => {
          if (warned) return;
          warned = true;
          toast.error("Edits could not be saved", { description: String(e) });
        });
      }, SAVE_DELAY);
    };
    const off = useEdit.subscribe((s, prev) => {
      if (s.edit !== prev.edit) save(s.edit);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [videoPath]);
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof PlayIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
          <HugeiconsIcon icon={icon} strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TopBar({ name, onExport }: { name: string; onExport: () => void }) {
  const navigate = useNavigate();
  const canUndo = useEdit((s) => s.past.length > 0);
  const canRedo = useEdit((s) => s.future.length > 0);
  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-20">
      <IconButton label="Back to studio" icon={ArrowLeft01Icon} onClick={() => navigate({ to: "/" })} />
      <h1 data-tauri-drag-region className="flex-1 truncate text-center text-[13px] font-medium">
        {name}
        <span className="text-muted-foreground">.mp4</span>
      </h1>
      <IconButton label="Undo" icon={UndoIcon} onClick={() => useEdit.getState().undo()} disabled={!canUndo} />
      <IconButton label="Redo" icon={RedoIcon} onClick={() => useEdit.getState().redo()} disabled={!canRedo} />
      <Button size="sm" onClick={onExport} className="ml-2 gap-1.5 bg-violet-600 text-white hover:bg-violet-500">
        <HugeiconsIcon icon={Upload04Icon} strokeWidth={2} />
        Export
      </Button>
    </header>
  );
}

const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: 1, label: "Full", hint: "Sharpest" },
  { value: 0.5, label: "Half", hint: "Faster" },
  { value: 0.25, label: "Quarter", hint: "Fastest" },
];

function PreviewHeader() {
  const aspect = useEdit((s) => s.edit.aspect);
  const change = useEdit((s) => s.change);
  const quality = usePlayback((s) => s.quality);
  const setQuality = usePlayback((s) => s.setQuality);
  const current = ASPECT_OPTIONS.find((a) => a.id === aspect);

  return (
    <div className="flex h-10 shrink-0 items-center justify-between">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]">
            <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={1.75} />
            {current?.label}
            {current?.ratio ? <span className="text-muted-foreground">{current.ratio}</span> : null}
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.75} className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup
            value={aspect}
            onValueChange={(v) => change((ed) => ({ ...ed, aspect: v as AspectId }))}
          >
            {ASPECT_OPTIONS.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id}>
                {a.label}
                {a.ratio ? <span className="ml-auto text-muted-foreground">{a.ratio}</span> : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]">
            Preview quality
            <span className="text-muted-foreground">{QUALITIES.find((q) => q.value === quality)?.label}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.75} className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup value={String(quality)} onValueChange={(v) => setQuality(Number(v) as Quality)}>
            {QUALITIES.map((q) => (
              <DropdownMenuRadioItem key={q.value} value={String(q.value)}>
                {q.label}
                <span className="ml-auto text-muted-foreground">{q.hint}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Transport() {
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const duration = usePlayback((s) => s.duration);
  const end = useEdit((s) => trimEnd(s.edit, duration));
  const start = useEdit((s) => s.edit.trim.start);

  return (
    <div className="flex h-14 shrink-0 items-center justify-center gap-3">
      <span className="w-20 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
        {formatTime(Math.max(0, time - start), true)}
      </span>
      <IconButton label="Go to start (Cmd ←)" icon={PreviousIcon} onClick={player.first} />
      <Button
        variant="ghost"
        size="icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={player.toggle}
        className="rounded-full border border-white/15"
      >
        <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} strokeWidth={1.75} />
      </Button>
      <IconButton label="Go to end (Cmd →)" icon={NextIcon} onClick={player.last} />
      <span className="w-20 font-mono text-[12px] text-muted-foreground tabular-nums">
        {formatTime(Math.max(0, end - start), true)}
      </span>
    </div>
  );
}
