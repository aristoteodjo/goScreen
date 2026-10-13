import {
  Delete02Icon,
  FilmRoll01Icon,
  MoreHorizontalIcon,
  VideoReplayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { MenuTrigger } from "@/lib/menu";
import { ago, ConfirmDialog } from "@/modules/projects/dialogs";
import { useTabTitle } from "@/modules/tabs/tabs";
import {
  describeJob,
  renderingsOf,
  useFrame,
  useMotionProgress,
  useProgressEvents,
  useReferences,
} from "./hooks";
import { type Reference, motionIpc } from "./ipc";
import { LocalModelBadge, LocalModelDialog } from "./LocalModelDialog";
import { analyzeReference, deriveSpec } from "./pipeline";
import { refreshMotion } from "./store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];

// Reference videos to rebuild as motion specs. Creating one measures it and
// derives a first spec; the reference page then corrects and compares.
export function ReproduceHome() {
  useTabTitle("Reproduce");
  useProgressEvents();
  const navigate = useNavigate();
  const references = useReferences();
  const job = useMotionProgress((s) => s.job);
  const [model, setModel] = useState(false);
  const [removing, setRemoving] = useState<Reference | null>(null);
  const openRef = (id: string) => navigate({ to: "/reproduce", search: { reference: id } });

  const create = useMutation({
    mutationFn: async () => {
      const picked = await pickFile({
        multiple: false,
        filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
      });
      if (typeof picked !== "string") return null;
      const ref = await motionIpc.create(picked);
      refreshMotion();
      await analyzeReference(ref.id);
      await deriveSpec(ref.id);
      return ref;
    },
    onSuccess: (ref) => {
      refreshMotion();
      if (ref && typeof ref.id === "string") openRef(ref.id);
    },
    onError: (e) => {
      refreshMotion();
      toast.error(message(e));
    },
  });

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span data-tauri-drag-region className="text-[13px] font-semibold">
          Reproduce
        </span>
        <span className="text-[13px] text-muted-foreground">· Reference videos</span>
        <div className="ml-auto flex items-center gap-2">
          <LocalModelBadge onClick={() => setModel(true)} />
          <Button data-ai="motion-new" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : <HugeiconsIcon icon={VideoReplayIcon} size={15} />}
            {create.isPending ? (describeJob(job) ?? "Preparing…") : "New reference"}
          </Button>
        </div>
      </header>

      <main data-ai="references" className="min-h-0 flex-1 overflow-y-auto p-6">
        {references.isPending ? (
          <Grid>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-video rounded-xl" />
            ))}
          </Grid>
        ) : references.isError ? (
          <p className="text-sm text-destructive">Could not read the references: {message(references.error)}</p>
        ) : references.data.length === 0 ? (
          <div className="mx-auto mt-24 flex max-w-md flex-col items-center gap-3 text-center">
            <HugeiconsIcon icon={FilmRoll01Icon} size={40} className="text-muted-foreground" />
            <h2 className="text-base font-semibold">Rebuild a video you like</h2>
            <p className="text-sm text-muted-foreground">
              goScreen measures a motion-design video (cuts, words, timing, colours), writes it as a spec you can edit,
              renders it back and compares both, shot by shot. Each correction also teaches the local model.
            </p>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Spinner /> : null}
              {create.isPending ? (describeJob(job) ?? "Preparing…") : "Choose a video"}
            </Button>
          </div>
        ) : (
          <Grid>
            {references.data.map((r) => (
              <ReferenceCard key={r.id} reference={r} open={() => openRef(r.id)} remove={() => setRemoving(r)} />
            ))}
          </Grid>
        )}
      </main>

      <LocalModelDialog open={model} onOpenChange={setModel} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.name ?? ""}?`}
        description="Its folder (measurements, spec, renderings) goes to the system trash. The original video is not touched, nor what the local model learnt from it."
        action="Move to trash"
        onConfirm={async () => {
          if (!removing) return;
          await motionIpc.remove(removing.id);
          refreshMotion();
        }}
      />
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">{children}</div>;
}

function ReferenceCard({ reference: r, open, remove }: { reference: Reference; open: () => void; remove: () => void }) {
  const thumb = useFrame(r.id, "reference", 1, 480);
  const renders = renderingsOf(r.files).length;
  const status = !r.files.includes("spec.json")
    ? "Not measured"
    : renders
      ? `${renders} rendering${renders === 1 ? "" : "s"}`
      : "Spec ready";
  return (
    <ContextMenu>
      <MenuTrigger>
        <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card/50 transition hover:border-white/20">
          <button type="button" onClick={open} className="absolute inset-0 z-10" aria-label={`Open ${r.name}`} />
          <div className="aspect-video bg-black">
            {thumb.data ? <img src={thumb.data} alt="" className="size-full object-contain" /> : null}
          </div>
          <div className="flex flex-col p-3">
            <span className="truncate text-sm font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground">
              {status} · {ago(r.created)}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Reference actions"
                className="absolute top-2 right-2 z-20 flex size-7 items-center justify-center rounded-md bg-black/50 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={open}>Open</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <HugeiconsIcon icon={Delete02Icon} size={14} />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </MenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={open}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={remove}>
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
