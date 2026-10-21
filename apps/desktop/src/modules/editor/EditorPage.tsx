import { InspirationDialog } from "@/modules/inspiration/InspirationDialog";
import { useTabTitle } from "@/modules/tabs/tabs";
import {
  ASPECT_OPTIONS,
  type AspectId,
  buildAutoZooms,
  clampToSource,
  clipsWithout,
  DEFAULT_EDIT,
  type EditState,
  EMPTY_RECORDING,
  outputSize,
  parseEditState,
  parseRecordingFile,
  type RecordingFile,
  stageArea,
} from "@goscreen/render-engine";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Home01Icon,
  Mic01Icon,
  Scissor01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RedoIcon,
  UndoIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipc } from "@/lib/ipc";
import { VIEW_ZOOMS } from "./commands";
import { initialLayers } from "./devices";
import { EditorPalette } from "./EditorPalette";
import { BlocksDialog } from "./BlocksDialog";
import { CompositionsDialog } from "./CompositionsDialog";
import { ExportDialog } from "./ExportDialog";
import { cn } from "@/lib/utils";
import { editActions } from "./actions";
import { PanelFrame } from "./PanelFrame";
import { Inspector } from "./Panels";
import { ProjectPanel } from "./ProjectPanel";
import { startVoiceOver, VoiceOverOverlay } from "./voiceover";
import { WORKSPACES, type WorkspaceId, useWorkspace } from "./workspace";
import { Preview } from "./Preview";
import { player, requestPaint, useSession } from "./session";
import { type Quality, timelineEnd, useEdit, usePlayback } from "./store";
import { Timeline } from "./Timeline";
import { timecode } from "./timecode";
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
      toast.warning(
        "Interactions could not be read; touches and auto zoom are off.",
      );
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
      chapters: file.chapters,
      mediaOffset: file.mediaOffset,
      assetUrls: data.assets,
    });
    // A first open cuts out what was recorded while paused.
    const fresh = {
      ...DEFAULT_EDIT,
      camera: file.camera ?? DEFAULT_EDIT.camera,
      clips:
        file.pauses.length > 0
          ? clipsWithout(file.pauses, (i) => `clip-${i + 1}`)
          : DEFAULT_EDIT.clips,
    };
    useEdit.getState().load(saved ?? fresh);
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
  useTabTitle(recording.data?.name);
  useCanvasFonts();
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
    // Clips saved as "until the end" get the real end now.
    const clamped = clampToSource(useEdit.getState().edit.clips, el.duration);
    if (clamped !== useEdit.getState().edit.clips) {
      const { edit, past, future } = useEdit.getState();
      useEdit.setState({ edit: { ...edit, clips: clamped }, past, future });
    }
    if (needsAutoZoom.current) {
      needsAutoZoom.current = false;
      const { pointers, layers, cameraUrl } = useSession.getState();
      const edit = useEdit.getState().edit;
      const zooms = buildAutoZooms(pointers, el.duration);
      // A fresh layered recording starts with its devices side by side.
      const area = stageArea(
        outputSize(edit.aspect, source),
        edit.camera,
        cameraUrl !== null,
      );
      const placed = layers.length > 0 ? initialLayers(layers, area) : null;
      useEdit.getState().load({ ...edit, zooms, layers: placed });
    }
    player.seek(0);
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
          <EditorLayout />
        </>
      )}
      <ExportDialog open={exporting} onOpenChange={setExporting} />
      <BlocksDialog />
      <CompositionsDialog />
      <InspirationDialog />
      <EditorPalette openExport={openExport} />
    </div>
  );
}

// Premiere's layout: Project | Program | Effect Controls over the timeline.
// Panel sizes survive reloads, per workspace; numbers are px, strings are %.
const SIZES: Record<
  WorkspaceId,
  { top: string; project: string; program: string; inspector: string }
> = {
  edit: { top: "58", project: "24", program: "48", inspector: "28" },
  animation: { top: "56", project: "20", program: "44", inspector: "36" },
  film: { top: "62", project: "22", program: "50", inspector: "28" },
  audio: { top: "46", project: "26", program: "44", inspector: "30" },
};

function EditorLayout() {
  const workspace = useWorkspace((s) => s.workspace);
  return <WorkspaceLayout key={workspace} workspace={workspace} />;
}

function WorkspaceLayout({ workspace }: { workspace: WorkspaceId }) {
  const rows = useDefaultLayout({
    id: `editor-rows-${workspace}`,
    storage: safeStorage,
  });
  const cols = useDefaultLayout({
    id: `editor-cols-${workspace}`,
    storage: safeStorage,
  });
  const size = SIZES[workspace];
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1 gap-[3px] p-[3px] pt-0"
      {...rows}
    >
      <ResizablePanel id="top" defaultSize={size.top} minSize={200}>
        <ResizablePanelGroup
          orientation="horizontal"
          className="gap-[3px]"
          {...cols}
        >
          <ResizablePanel
            id="project"
            defaultSize={size.project}
            minSize={180}
            className="overflow-hidden rounded-md"
          >
            <ProjectPanel />
          </ResizablePanel>
          <ResizableHandle className="bg-transparent" />
          <ResizablePanel
            id="program"
            defaultSize={size.program}
            minSize="25"
            className="overflow-hidden rounded-md"
          >
            <ProgramMonitor />
          </ResizablePanel>
          <ResizableHandle className="bg-transparent" />
          <ResizablePanel
            id="inspector"
            defaultSize={size.inspector}
            minSize={260}
            className="overflow-hidden rounded-md"
          >
            <Inspector />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle className="bg-transparent" />
      <ResizablePanel
        id="timeline"
        defaultSize={`${100 - Number(size.top)}`}
        minSize={150}
        className="overflow-hidden rounded-md bg-[var(--panel)]"
      >
        <Timeline />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function ProgramMonitor() {
  return (
    <PanelFrame
      ai="program"
      tabs={[{ id: "program", label: "Program" }]}
      active="program"
      actions={<ViewZoomMenu />}
      bodyClassName="flex flex-col"
    >
      <div className="relative flex min-h-0 flex-1 flex-col px-2">
        <Preview />
        <VoiceOverOverlay />
      </div>
      <MonitorBar />
      <Transport />
    </PanelFrame>
  );
}

/**
 * The canvas draws with whatever fonts are loaded: a web font used only by
 * the montage would show as a fallback until something loads it. Every
 * family the edit names is loaded, then the frame is drawn again.
 */
function useCanvasFonts() {
  const families = useEdit((s) => {
    const set = new Set<string>(['"JetBrains Mono"']);
    for (const o of s.edit.overlays)
      if (o.kind === "text") set.add(o.style.font);
    for (const c of s.edit.clips) if (c.kind === "slide") set.add(c.font);
    return [...set].sort().join("|");
  });
  useEffect(() => {
    if (!document.fonts) return;
    const loads = families
      .split("|")
      .flatMap((f) =>
        [400, 500, 800].map((w) =>
          document.fonts.load(`${w} 32px ${f}`).catch(() => []),
        ),
      );
    void Promise.all(loads).then(requestPaint);
  }, [families]);
}

// localStorage can throw (private mode); layouts are a convenience.
const safeStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

function useAutosave(videoPath: string | null) {
  useEffect(() => {
    if (!videoPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warned = false;
    const save = (edit: EditState) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending = null;
        ipc.editSave(videoPath, edit).catch((e) => {
          if (warned) return;
          warned = true;
          toast.error("Edits could not be saved", { description: String(e) });
        });
      }, SAVE_DELAY);
    };
    let pending: EditState | null = null;
    const off = useEdit.subscribe((s, prev) => {
      if (s.edit === prev.edit) return;
      pending = s.edit;
      save(s.edit);
    });
    return () => {
      off();
      clearTimeout(timer);
      // Leaving (another tab, another page) saves what is still waiting.
      if (pending) void ipc.editSave(videoPath, pending).catch(() => {});
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
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
  const workspace = useWorkspace((s) => s.workspace);
  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-1 pr-3 pl-3"
    >
      <IconButton
        label="Home"
        icon={Home01Icon}
        onClick={() =>
          // Back where the video was opened from: a project, the studio...
          window.history.length > 1
            ? window.history.back()
            : navigate({ to: "/" })
        }
      />
      <nav className="ml-2 flex items-center gap-1 text-[13px]">
        <button
          type="button"
          onClick={() =>
            void editActions.importMedia(["image", "video", "audio"], {
              place: false,
            })
          }
          className="rounded px-2 py-1 text-muted-foreground hover:text-foreground"
        >
          Import
        </button>
        <span className="rounded px-2 py-1 text-foreground underline decoration-1 underline-offset-[6px]">
          Edit
        </span>
        <button
          type="button"
          onClick={onExport}
          className="rounded px-2 py-1 text-muted-foreground hover:text-foreground"
        >
          Export
        </button>
      </nav>
      <h1
        data-tauri-drag-region
        className="flex-1 truncate px-4 text-center text-[13px] font-medium"
      >
        {name}
        <span className="text-muted-foreground"> · Edited</span>
      </h1>
      <nav
        aria-label="Workspaces"
        className="mr-2 flex items-center gap-0.5 text-[12px]"
      >
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => useWorkspace.getState().setWorkspace(w.id)}
            className={cn(
              "rounded px-2 py-1 tracking-wide uppercase",
              workspace === w.id
                ? "text-sky-300"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {w.label}
          </button>
        ))}
      </nav>
      <IconButton
        label="Undo"
        icon={UndoIcon}
        onClick={() => useEdit.getState().undo()}
        disabled={!canUndo}
      />
      <IconButton
        label="Redo"
        icon={RedoIcon}
        onClick={() => useEdit.getState().redo()}
        disabled={!canRedo}
      />
      <Button
        size="sm"
        data-ai="export"
        onClick={onExport}
        className="ml-2 gap-1.5 bg-sky-600 text-white hover:bg-sky-500"
      >
        <HugeiconsIcon icon={Upload04Icon} strokeWidth={2} />
        Export
      </Button>
    </header>
  );
}

const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: 1, label: "Full", hint: "Sharpest" },
  { value: 0.5, label: "1/2", hint: "Faster" },
  { value: 0.25, label: "1/4", hint: "Fastest" },
];

/** Under the monitor, Premiere style: playhead timecode, format, quality, length. */
function MonitorBar() {
  const aspect = useEdit((s) => s.edit.aspect);
  const change = useEdit((s) => s.change);
  const quality = usePlayback((s) => s.quality);
  const setQuality = usePlayback((s) => s.setQuality);
  const time = usePlayback((s) => s.time);
  const end = useEdit((s) => timelineEnd(s.edit));
  const current = ASPECT_OPTIONS.find((a) => a.id === aspect);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 px-3">
      <span className="w-24 font-mono text-[14px] text-sky-400 tabular-nums">
        {timecode(time)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[12px]"
          >
            {current?.label}
            {current?.ratio ? (
              <span className="text-muted-foreground">{current.ratio}</span>
            ) : null}
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={1.75}
              className="opacity-60"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup
            value={aspect}
            onValueChange={(v) =>
              change((ed) => ({ ...ed, aspect: v as AspectId }))
            }
          >
            {ASPECT_OPTIONS.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id}>
                {a.label}
                {a.ratio ? (
                  <span className="ml-auto text-muted-foreground">
                    {a.ratio}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[12px]"
            title="Playback resolution"
          >
            {QUALITIES.find((q) => q.value === quality)?.label}
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={1.75}
              className="opacity-60"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuRadioGroup
            value={String(quality)}
            onValueChange={(v) => setQuality(Number(v) as Quality)}
          >
            {QUALITIES.map((q) => (
              <DropdownMenuRadioItem key={q.value} value={String(q.value)}>
                {q.label}
                <span className="ml-auto text-muted-foreground">{q.hint}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto font-mono text-[14px] text-foreground/90 tabular-nums">
        {timecode(end)}
      </span>
    </div>
  );
}

function ViewZoomMenu() {
  const viewZoom = usePlayback((s) => s.viewZoom);
  const setViewZoom = usePlayback((s) => s.setViewZoom);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-20 justify-between gap-1 font-mono text-[12px] tabular-nums"
        >
          {viewZoom === null ? "Fit" : `${Math.round(viewZoom * 100)}%`}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={1.75}
            className="opacity-60"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={viewZoom === null ? "fit" : String(viewZoom)}
          onValueChange={(v) => setViewZoom(v === "fit" ? null : Number(v))}
        >
          <DropdownMenuRadioItem value="fit">
            Fit
            <span className="ml-auto text-muted-foreground">⇧1</span>
          </DropdownMenuRadioItem>
          {VIEW_ZOOMS.map((z) => (
            <DropdownMenuRadioItem key={z} value={String(z)}>
              {Math.round(z * 100)}%
              {z === 1 ? (
                <span className="ml-auto text-muted-foreground">⌘0</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Transport() {
  const playing = usePlayback((s) => s.playing);
  const frame = 1 / 30;
  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-white/5">
      <IconButton
        label="Go to start (⌘ ←)"
        icon={PreviousIcon}
        onClick={player.first}
      />
      <IconButton
        label="Step back one frame (←)"
        icon={ArrowLeft01Icon}
        onClick={() => player.step(-frame)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={player.toggle}
        className="mx-1"
      >
        <HugeiconsIcon
          icon={playing ? PauseIcon : PlayIcon}
          strokeWidth={1.75}
        />
      </Button>
      <IconButton
        label="Step forward one frame (→)"
        icon={ArrowRight01Icon}
        onClick={() => player.step(frame)}
      />
      <IconButton
        label="Go to end (⌘ →)"
        icon={NextIcon}
        onClick={player.last}
      />
      <span className="mx-2 h-4 w-px bg-white/10" />
      <IconButton
        label="Split at the playhead (S)"
        icon={Scissor01Icon}
        onClick={editActions.splitAtPlayhead}
      />
      <IconButton
        label="Record a voice-over from the playhead"
        icon={Mic01Icon}
        onClick={() => void startVoiceOver()}
      />
    </div>
  );
}
