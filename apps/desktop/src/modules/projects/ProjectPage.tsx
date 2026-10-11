import {
  flowFromScenario,
  newFlow,
  parseFlow,
  parseScenario,
} from "@goscreen/scenario";
import {
  Add01Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  FlowConnectionIcon,
  MoreHorizontalIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { projectsIpc, type VideoEntry, type VslEntry } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { registry } from "@/lib/registry";
import { normalizeUrl } from "@/lib/url";
import { record, simulate } from "@/modules/flow/runs";
import { ago, ConfirmDialog, NameDialog } from "./dialogs";
import { projectKeys } from "./ProjectsHome";

type Pending =
  | { kind: "new" }
  | { kind: "rename-project" }
  | { kind: "rename"; vsl: VslEntry }
  | { kind: "delete"; vsl: VslEntry }
  | { kind: "delete-video"; video: VideoEntry }
  | null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const phones = registry.list();

// One project: its VSL flows (scripted journeys) and the videos made from them.
export function ProjectPage({ project }: { project: string }) {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: projectKeys.list(),
    queryFn: projectsIpc.list,
  });
  const vsls = useQuery({
    queryKey: projectKeys.vsls(project),
    queryFn: () => projectsIpc.vsls(project),
  });
  const videos = useQuery({
    queryKey: projectKeys.videos(project),
    queryFn: () => projectsIpc.videos(project),
  });
  const name = projects.data?.find((p) => p.id === project)?.name ?? project;
  const [pending, setPending] = useState<Pending>(null);
  const [url, setUrl] = useState("https://");
  const [device, setDevice] = useState("galaxy-s25");
  const fileInput = useRef<HTMLInputElement>(null);
  const close = (open: boolean) => {
    if (!open) setPending(null);
  };
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.all });
  const openVsl = (vsl: string) =>
    navigate({ to: "/flow", search: { project, vsl } });

  const runAll = async (vsl: VslEntry, kind: "simulate" | "record") => {
    try {
      const parsed = parseFlow(await projectsIpc.loadVsl(project, vsl.id));
      if (!parsed.ok) throw new Error(parsed.errors[0]);
      const target = { project, vsl: vsl.id };
      if (kind === "simulate") simulate(parsed.flow, target);
      else record(parsed.flow, target);
    } catch (e) {
      toast.error(message(e), {
        action: { label: "Open the flow", onClick: () => openVsl(vsl.id) },
      });
    }
  };

  const importScenario = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseScenario(await file.text());
    if (!parsed.ok) {
      toast.error("Not a valid scenario", { description: parsed.errors[0] });
      return;
    }
    try {
      const flow = flowFromScenario(parsed.scenario);
      const id = await projectsIpc.createVsl(project, flow.name, flow);
      await refresh();
      openVsl(id);
    } catch (e) {
      toast.error(message(e));
    }
  };

  const vslItems = (v: VslEntry) => [
    { label: "Open the flow", onSelect: () => openVsl(v.id) },
    { label: "Simulate every journey", onSelect: () => runAll(v, "simulate") },
    { label: "Record the VSL", onSelect: () => runAll(v, "record") },
    {
      label: "Rename…",
      onSelect: () => setPending({ kind: "rename", vsl: v }),
    },
    {
      label: "Duplicate",
      onSelect: async () => {
        try {
          await projectsIpc.duplicateVsl(project, v.id);
          await refresh();
        } catch (e) {
          toast.error(message(e));
        }
      },
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-20"
      >
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="All projects"
          onClick={() => navigate({ to: "/" })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
        </Button>
        <button
          type="button"
          className="truncate text-[13px] font-semibold hover:underline"
          title="Rename"
          onClick={() => setPending({ kind: "rename-project" })}
        >
          {name}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
          >
            Import a scenario…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void importScenario(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => setPending({ kind: "new" })}>
            <HugeiconsIcon icon={Add01Icon} size={15} />
            New VSL
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            VSLs
          </h2>
          {vsls.isPending ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : vsls.isError ? (
            <p className="text-sm text-destructive">{String(vsls.error)}</p>
          ) : vsls.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No VSL yet. A VSL is a flow of scenes that a browser plays on your
              site, simulated first, then recorded and edited.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {vsls.data.map((v) => (
                <ContextMenu key={v.id}>
                  <MenuTrigger>
                    <div className="group relative flex items-center gap-3 rounded-xl border bg-card/50 p-3 hover:border-white/20 hover:bg-card">
                      <button
                        type="button"
                        className="absolute inset-0 rounded-xl"
                        aria-label={`Open ${v.name}`}
                        onClick={() => openVsl(v.id)}
                      />
                      <HugeiconsIcon
                        icon={FlowConnectionIcon}
                        size={22}
                        className="text-sky-400"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {v.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ago(v.modifiedMs)}
                        </span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="VSL actions"
                            className="relative ml-auto flex size-7 items-center justify-center rounded-md hover:bg-white/10"
                          >
                            <HugeiconsIcon
                              icon={MoreHorizontalIcon}
                              size={16}
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {vslItems(v).map((i) => (
                            <DropdownMenuItem
                              key={i.label}
                              onSelect={i.onSelect}
                            >
                              {i.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              setPending({ kind: "delete", vsl: v })
                            }
                          >
                            <HugeiconsIcon icon={Delete02Icon} size={14} />
                            Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </MenuTrigger>
                  <ContextMenuContent>
                    {vslItems(v).map((i) => (
                      <ContextMenuItem key={i.label} onClick={i.onSelect}>
                        {i.label}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => setPending({ kind: "delete", vsl: v })}
                    >
                      Delete…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Videos
          </h2>
          {videos.isPending ? (
            <Skeleton className="h-10 rounded-lg" />
          ) : videos.isError ? (
            <p className="text-sm text-destructive">{String(videos.error)}</p>
          ) : videos.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Recorded VSLs and their exports land here.
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-xl border">
              {videos.data.map((v) => (
                <ContextMenu key={v.path}>
                  <MenuTrigger>
                    <button
                      type="button"
                      onClick={() =>
                        navigate({ to: "/editor", search: { video: v.path } })
                      }
                      className="flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
                    >
                      <HugeiconsIcon
                        icon={Video01Icon}
                        size={16}
                        className="text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {v.name}
                      </span>
                      {v.export ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          Export
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {ago(v.modifiedMs)}
                      </span>
                    </button>
                  </MenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() =>
                        navigate({ to: "/editor", search: { video: v.path } })
                      }
                    >
                      Open in editor
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => void revealItemInDir(v.path)}
                    >
                      Show in Finder
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() =>
                        setPending({ kind: "delete-video", video: v })
                      }
                    >
                      Delete…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </section>
      </main>

      <NameDialog
        open={pending?.kind === "new"}
        onOpenChange={close}
        title="New VSL"
        label="A flow of scenes played on your site, then edited into a video."
        action="Create"
        onSubmit={async (vslName) => {
          const start = normalizeUrl(url);
          if (!start) throw new Error("Enter the site address (https://…).");
          const flow = newFlow(vslName, start, device);
          const id = await projectsIpc.createVsl(project, vslName, flow);
          await refresh();
          openVsl(id);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vsl-url">Start page</Label>
          <Input
            id="vsl-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="h-9 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Device</Label>
          <Select value={device} onValueChange={setDevice}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {phones.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </NameDialog>
      <NameDialog
        open={pending?.kind === "rename-project"}
        onOpenChange={close}
        title="Rename project"
        label="The folder keeps its place; only the name changes."
        initial={name}
        action="Rename"
        onSubmit={async (next) => {
          await projectsIpc.rename(project, next);
          await refresh();
        }}
      />
      <NameDialog
        open={pending?.kind === "rename"}
        onOpenChange={close}
        title="Rename VSL"
        label="Its videos keep their file names."
        initial={pending?.kind === "rename" ? pending.vsl.name : ""}
        action="Rename"
        onSubmit={async (next) => {
          if (pending?.kind !== "rename") return;
          await projectsIpc.renameVsl(project, pending.vsl.id, next);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={close}
        title={`Delete ${pending?.kind === "delete" ? pending.vsl.name : ""}?`}
        description="The flow goes to the system trash. Videos already recorded stay in the project."
        action="Move to trash"
        onConfirm={async () => {
          if (pending?.kind !== "delete") return;
          await projectsIpc.removeVsl(project, pending.vsl.id);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "delete-video"}
        onOpenChange={close}
        title="Delete this video?"
        description="The video, its interactions and its edit go to the system trash."
        action="Move to trash"
        onConfirm={async () => {
          if (pending?.kind !== "delete-video") return;
          await projectsIpc.removeVideo(project, pending.video.path);
          await refresh();
        }}
      />
    </div>
  );
}
