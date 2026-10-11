import {
  Copy01Icon,
  Delete02Icon,
  Folder01Icon,
  FolderAddIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { MenuTrigger } from "@/lib/menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { type ProjectEntry, projectsIpc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { ago, ConfirmDialog, NameDialog } from "./dialogs";

export const projectKeys = {
  all: ["projects"] as const,
  list: () => ["projects", "list"] as const,
  vsls: (id: string) => ["projects", id, "vsls"] as const,
  videos: (id: string) => ["projects", id, "videos"] as const,
};

const refresh = () =>
  queryClient.invalidateQueries({ queryKey: projectKeys.all });

type Pending =
  | { kind: "create" }
  | { kind: "rename"; project: ProjectEntry }
  | { kind: "delete"; project: ProjectEntry }
  | null;

// Home: one folder per project; a project holds its VSLs and their videos.
export function ProjectsHome() {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: projectKeys.list(),
    queryFn: projectsIpc.list,
  });
  const [pending, setPending] = useState<Pending>(null);
  const close = (open: boolean) => {
    if (!open) setPending(null);
  };
  const open = (id: string) =>
    navigate({ to: "/projects/$project", params: { project: id } });

  const actions = (p: ProjectEntry) => ({
    open: () => open(p.id),
    rename: () => setPending({ kind: "rename", project: p }),
    duplicate: async () => {
      try {
        await projectsIpc.duplicate(p.id);
        await refresh();
        toast.success(`${p.name} duplicated (VSLs only, not the videos)`);
      } catch (e) {
        toast.error(String(e));
      }
    },
    remove: () => setPending({ kind: "delete", project: p }),
  });

  return (
    <div className="flex h-full flex-col">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-20"
      >
        <span data-tauri-drag-region className="text-[13px] font-semibold">
          goScreen
        </span>
        <span className="text-[13px] text-muted-foreground">· Projects</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ to: "/studio" })}
          >
            <HugeiconsIcon icon={SmartPhone01Icon} size={15} />
            Open the studio
          </Button>
          <Button size="sm" onClick={() => setPending({ kind: "create" })}>
            <HugeiconsIcon icon={FolderAddIcon} size={15} />
            New project
          </Button>
        </div>
      </header>

      <ContextMenu>
        <MenuTrigger>
          <main className="min-h-0 flex-1 overflow-y-auto p-6">
            {projects.isPending ? (
              <Grid>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-xl" />
                ))}
              </Grid>
            ) : projects.isError ? (
              <p className="text-sm text-destructive">
                Could not read the projects: {String(projects.error)}
              </p>
            ) : projects.data.length === 0 ? (
              <div className="mx-auto mt-24 flex max-w-sm flex-col items-center gap-3 text-center">
                <HugeiconsIcon
                  icon={Folder01Icon}
                  size={40}
                  className="text-muted-foreground"
                />
                <h2 className="text-base font-semibold">No project yet</h2>
                <p className="text-sm text-muted-foreground">
                  A project is a folder for one product or client: its VSL
                  flows, simulations and recorded videos.
                </p>
                <Button onClick={() => setPending({ kind: "create" })}>
                  Create a project
                </Button>
              </div>
            ) : (
              <Grid>
                {projects.data.map((p) => (
                  <ProjectCard key={p.id} project={p} {...actions(p)} />
                ))}
              </Grid>
            )}
          </main>
        </MenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setPending({ kind: "create" })}>
            New project
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void refresh()}>
            Refresh
          </ContextMenuItem>
          <ContextMenuItem onClick={() => navigate({ to: "/studio" })}>
            Open the studio
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <NameDialog
        open={pending?.kind === "create"}
        onOpenChange={close}
        title="New project"
        label="One folder for a product or a client."
        action="Create"
        onSubmit={async (name) => {
          const id = await projectsIpc.create(name);
          await refresh();
          open(id);
        }}
      />
      <NameDialog
        open={pending?.kind === "rename"}
        onOpenChange={close}
        title="Rename project"
        label="The folder keeps its place; only the name changes."
        initial={pending?.kind === "rename" ? pending.project.name : ""}
        action="Rename"
        onSubmit={async (name) => {
          if (pending?.kind !== "rename") return;
          await projectsIpc.rename(pending.project.id, name);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={close}
        title={`Delete ${pending?.kind === "delete" ? pending.project.name : ""}?`}
        description="The whole folder, its VSLs and its videos go to the system trash. You can restore them from there."
        action="Move to trash"
        onConfirm={async () => {
          if (pending?.kind !== "delete") return;
          await projectsIpc.remove(pending.project.id);
          await refresh();
        }}
      />
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {children}
    </div>
  );
}

function ProjectCard({
  project: p,
  open,
  rename,
  duplicate,
  remove,
}: {
  project: ProjectEntry;
  open: () => void;
  rename: () => void;
  duplicate: () => void;
  remove: () => void;
}) {
  const items = [
    { label: "Open", onSelect: open, icon: Folder01Icon },
    { label: "Rename…", onSelect: rename, icon: PencilEdit02Icon },
    { label: "Duplicate", onSelect: duplicate, icon: Copy01Icon },
  ];
  return (
    <ContextMenu>
      <MenuTrigger>
        <div className="group relative flex h-36 flex-col rounded-xl border bg-card/50 p-4 text-left transition hover:border-white/20 hover:bg-card">
          <button
            type="button"
            onClick={open}
            className="absolute inset-0 rounded-xl"
            aria-label={`Open ${p.name}`}
          />
          <HugeiconsIcon
            icon={Folder01Icon}
            size={28}
            className="text-amber-400"
          />
          <span className="mt-auto truncate text-sm font-medium">{p.name}</span>
          <span className="text-xs text-muted-foreground">
            {p.vsls} VSL{p.vsls === 1 ? "" : "s"} · {p.videos} video
            {p.videos === 1 ? "" : "s"} · {ago(p.modifiedMs)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Project actions"
                className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 focus:opacity-100"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {items.map((i) => (
                <DropdownMenuItem key={i.label} onSelect={i.onSelect}>
                  <HugeiconsIcon icon={i.icon} size={14} />
                  {i.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <HugeiconsIcon icon={Delete02Icon} size={14} />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </MenuTrigger>
      <ContextMenuContent>
        {items.map((i) => (
          <ContextMenuItem key={i.label} onClick={i.onSelect}>
            {i.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={remove}>
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
