import { outputSize } from "@goscreen/render-engine";
import { useMutation } from "@tanstack/react-query";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { exportVideo } from "./exportVideo";
import { assetUrl, currentTimeline, player, useSession } from "./session";
import { useEdit } from "./store";

const RESOLUTIONS = [
  { id: "720", label: "720p", longSide: 1280 },
  { id: "1080", label: "1080p", longSide: 1920 },
  { id: "2160", label: "4K", longSide: 3840 },
] as const;

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [resolution, setResolution] =
    useState<(typeof RESOLUTIONS)[number]["id"]>("1080");
  const [fps, setFps] = useState(60);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const source = useSession((s) => s.source);
  const aspect = useEdit((s) => s.edit.aspect);
  const longSide =
    RESOLUTIONS.find((r) => r.id === resolution)?.longSide ?? 1920;
  const size = source ? outputSize(aspect, source, longSide) : null;

  const run = useMutation({
    mutationFn: async () => {
      const { videoUrl, videoPath, cameraUrl, micUrl, mediaOffset, name } =
        useSession.getState();
      const timeline = currentTimeline();
      // A montage without a recording has no videoUrl and exports all the same.
      if (!videoPath || !timeline)
        throw new Error("The recording is not loaded yet.");
      player.pause();
      setProgress(0);
      abort.current = new AbortController();
      return exportVideo({
        edit: useEdit.getState().edit,
        timeline,
        videoUrl,
        videoPath,
        cameraUrl,
        mediaOffset,
        hasMic: micUrl !== null,
        assetUrl: (id) => assetUrl(useEdit.getState().edit, id),
        name,
        longSide,
        fps,
        signal: abort.current.signal,
        onProgress: setProgress,
      });
    },
    onSuccess: (r) => {
      if (typeof r?.file !== "string" || r.file.length === 0) {
        toast.error("Export finished without a file.");
        return;
      }
      const path = r.file;
      toast.success("Video exported", {
        description:
          r.chunks.reused > 0
            ? `${r.chunks.reused} of ${r.chunks.total} chunks came from the render cache.`
            : undefined,
        action: { label: "Show", onClick: () => revealItemInDir(path) },
      });
    },
    onError: (e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("Export failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const close = (next: boolean) => {
    if (!next && run.isPending) return;
    if (!next) run.reset();
    onOpenChange(next);
  };

  const done = run.isSuccess ? run.data.file : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={!run.isPending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Export complete" : "Export MP4"}</DialogTitle>
          <DialogDescription>
            {done
              ? done
              : "Rendered frame by frame with your zooms, touch indicators and sounds. The source recording is untouched."}
          </DialogDescription>
        </DialogHeader>

        {done ? null : (
          <div className="flex flex-col gap-4">
            <Option
              label="Resolution"
              value={size ? `${size.width} × ${size.height}` : ""}
            >
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={resolution}
                disabled={run.isPending}
                onValueChange={(v) =>
                  v && setResolution(v as typeof resolution)
                }
                className="w-full"
              >
                {RESOLUTIONS.map((r) => (
                  <ToggleGroupItem key={r.id} value={r.id} className="flex-1">
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Option>
            <Option label="Frame rate">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={String(fps)}
                disabled={run.isPending}
                onValueChange={(v) => v && setFps(Number(v))}
                className="w-full"
              >
                <ToggleGroupItem value="30" className="flex-1">
                  30 fps
                </ToggleGroupItem>
                <ToggleGroupItem value="60" className="flex-1">
                  60 fps
                </ToggleGroupItem>
              </ToggleGroup>
            </Option>
            {run.isPending ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-[width]"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  Rendering {Math.round(progress * 100)}%
                </span>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <>
              <Button variant="ghost" onClick={() => revealItemInDir(done)}>
                Show in Finder
              </Button>
              <Button onClick={() => openPath(done)}>Open video</Button>
            </>
          ) : run.isPending ? (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button
              className="bg-violet-600 text-white hover:bg-violet-500"
              onClick={() => run.mutate()}
              disabled={!source}
            >
              Export
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {value ? (
          <span className="font-mono text-[11px] text-foreground/80 tabular-nums">
            {value}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
