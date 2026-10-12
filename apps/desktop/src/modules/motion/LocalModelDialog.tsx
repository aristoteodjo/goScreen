import { FINE_TUNE_MIN_EXAMPLES } from "@goscreen/motion";
import { useMutation } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useLocalAi, useMotionProgress, useTraining } from "./hooks";
import { localAiIpc } from "./ipc";
import { exportTraining } from "./pipeline";
import { motionKeys } from "./store";
import { queryClient } from "@/lib/queryClient";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
const refreshAi = () => queryClient.invalidateQueries({ queryKey: motionKeys.localAi() });

/** A dot and a word for the status bar of the Reproduce screens. */
export function LocalModelBadge({ onClick }: { onClick: () => void }) {
  const status = useLocalAi();
  const running = status.data?.models.find((m) => m.id === status.data?.running);
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <span
        className={cn(
          "size-2 rounded-full",
          running ? "bg-emerald-400" : "bg-muted-foreground/50",
        )}
      />
      {running ? running.label : "Local model off"}
    </Button>
  );
}

/**
 * The model that runs inside goScreen: which one, and what it has learnt
 * from its teachers so far.
 */
export function LocalModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useLocalAi();
  const training = useTraining();
  const install = useMotionProgress((s) => s.install);

  const run = useMutation({
    mutationFn: async ({ action, id }: { action: "install" | "start" | "stop" | "remove"; id: string }) => {
      if (action === "install") await localAiIpc.install(id);
      else if (action === "start") await localAiIpc.start(id);
      else if (action === "stop") await localAiIpc.stop();
      else await localAiIpc.remove(id);
      return action;
    },
    onSuccess: (action) => {
      if (action === "start") toast.success("The local model is ready");
    },
    onError: (e) => toast.error(message(e)),
    onSettled: () => void refreshAi(),
  });
  const exported = useMutation({
    mutationFn: exportTraining,
    onSuccess: (folder) => {
      if (typeof folder !== "string" || !folder) return;
      toast.success("train.jsonl written", {
        action: { label: "Show", onClick: () => void revealItemInDir(`${folder}/train.jsonl`) },
      });
    },
    onError: (e) => toast.error(message(e)),
  });

  const s = status.data;
  const t = training.data;
  const vision = s?.models.filter((m) => m.kind === "vision") ?? [];
  const ocr = s?.models.find((m) => m.kind === "ocr");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Local model</DialogTitle>
          <DialogDescription>
            A vision model that runs on this Mac: it reads the shots of a reference and learns from every correction
            Claude or you make. Nothing leaves the machine.
          </DialogDescription>
        </DialogHeader>

        {s && !s.server ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            llama-server was not found. Install it with <code>brew install llama.cpp</code>, then reopen this window.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {status.isPending ? <Spinner /> : null}
          {vision.map((m) => {
            const running = s?.running === m.id;
            const downloading = s?.downloading === m.id;
            const pending = run.isPending && run.variables?.id === m.id;
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {m.label}
                    {running ? <span className="text-xs text-emerald-400">running</span> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.description} · {gb(m.size)}
                  </p>
                  {downloading && install?.model === m.id && install.total ? (
                    <Bar value={install.done / install.total} className="mt-2" />
                  ) : null}
                </div>
                {!m.installed ? (
                  downloading ? (
                    <Button size="sm" variant="ghost" onClick={() => void localAiIpc.cancelInstall().then(refreshAi)}>
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!s?.downloading || pending}
                      onClick={() => run.mutate({ action: "install", id: m.id })}
                    >
                      Download
                    </Button>
                  )
                ) : running ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run.mutate({ action: "stop", id: m.id })}>
                    Stop
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run.mutate({ action: "remove", id: m.id })}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      disabled={pending || !s?.server}
                      onClick={() => run.mutate({ action: "start", id: m.id })}
                    >
                      {pending ? <Spinner /> : null}
                      Start
                    </Button>
                  </>
                )}
              </div>
            );
          })}
          {ocr && !ocr.installed ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
              <p className="flex-1 text-xs text-muted-foreground">
                {ocr.label}: better word reading when measuring a video ({gb(ocr.size)}).
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={!!s?.downloading}
                onClick={() => run.mutate({ action: "install", id: ocr.id })}
              >
                Download
              </Button>
            </div>
          ) : null}
        </div>

        <section className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <h3 className="text-sm font-medium">What it has learnt</h3>
          {t ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="examples" value={String(t.examples)} />
                <Stat
                  label="agreed overall"
                  value={t.judged ? `${Math.round((t.agreed / t.judged) * 100)} %` : "–"}
                />
                <Stat label="last 20" value={t.recent === null ? "–" : `${Math.round(t.recent * 100)} %`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Each correction becomes an example the model sees before its next questions. From{" "}
                {FINE_TUNE_MIN_EXAMPLES} examples, export them to fine-tune it (LoRA).
              </p>
              <Bar value={Math.min(1, t.examples / FINE_TUNE_MIN_EXAMPLES)} />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!t.examples || exported.isPending}
                  onClick={() => exported.mutate()}
                >
                  {exported.isPending ? <Spinner /> : null}
                  Export the training set
                </Button>
              </div>
            </>
          ) : (
            <Spinner />
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-white/10", className)}>
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
