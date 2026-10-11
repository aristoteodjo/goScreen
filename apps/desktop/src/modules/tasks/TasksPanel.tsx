import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  PlayIcon,
  TaskDaily01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { MenuTrigger } from "@/lib/menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { cancelTask } from "./queue";
import { isFinished, type Task, useTasks } from "./store";

// Background work, on every screen: what runs, how far it is, a live picture
// of the page, and one thumbnail per finished scene until the task ends.
export function TasksPanel() {
  const tasks = useTasks((s) => s.tasks);
  const open = useTasks((s) => s.panelOpen);
  const { setPanelOpen, clearFinished } = useTasks.getState();
  if (tasks.length === 0) return null;

  const running = tasks.find((t) => t.status === "running");
  const waiting = tasks.filter((t) => t.status === "queued").length;

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur hover:bg-popover"
      >
        {running ? (
          <Spinner className="size-3.5" />
        ) : (
          <HugeiconsIcon icon={TaskDaily01Icon} size={15} />
        )}
        {running
          ? `${running.label} · ${percent(running)}%`
          : `${tasks.length} task${tasks.length > 1 ? "s" : ""}`}
        {waiting > 0 ? (
          <span className="text-muted-foreground">+{waiting} waiting</span>
        ) : null}
      </button>
    );

  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-xl border bg-popover/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <HugeiconsIcon icon={TaskDaily01Icon} size={15} />
        <span className="text-xs font-semibold">Background tasks</span>
        <button
          type="button"
          onClick={clearFinished}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
        >
          Clear finished
        </button>
        <button
          type="button"
          aria-label="Minimise"
          onClick={() => setPanelOpen(false)}
          className="flex size-6 items-center justify-center rounded-md hover:bg-white/10"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} />
        </button>
      </div>
      <div className="flex min-h-0 flex-col divide-y overflow-y-auto">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

const percent = (t: Task) =>
  t.status === "done"
    ? 100
    : t.total > 0
      ? Math.min(99, Math.round((t.index / t.total) * 100))
      : 0;

function elapsed(t: Task) {
  if (!t.startedAt) return "";
  const s = Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function TaskRow({ task: t }: { task: Task }) {
  const navigate = useNavigate();
  const { remove } = useTasks.getState();
  const openVideo = () =>
    t.video && navigate({ to: "/editor", search: { video: t.video } });
  const openVsl = () =>
    t.project &&
    t.vsl &&
    navigate({ to: "/flow", search: { project: t.project, vsl: t.vsl } });

  return (
    <ContextMenu>
      <MenuTrigger>
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <StatusIcon status={t.status} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">{t.label}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {t.kind === "record" ? "Recording" : "Simulation"}
                {t.status === "running"
                  ? ` · step ${Math.min(t.index + 1, t.total)}/${t.total}${t.caption ? ` · ${t.caption}` : ""}`
                  : t.status === "queued"
                    ? " · waiting"
                    : ` · ${elapsed(t)}`}
              </span>
            </div>
            {t.status === "running" || t.status === "queued" ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => void cancelTask(t.id)}
              >
                Stop
              </Button>
            ) : t.video ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={openVideo}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
                Open
              </Button>
            ) : null}
          </div>

          {t.status === "running" || t.status === "queued" ? (
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-rec transition-[width]"
                style={{ width: `${percent(t)}%` }}
              />
            </div>
          ) : null}

          {t.status === "running" && t.preview ? (
            <img
              src={t.preview}
              alt="What the browser shows now"
              className="max-h-56 self-center rounded-md border object-contain"
            />
          ) : null}

          {t.scenes.length > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {t.scenes.map((m, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: scenes come in order and never move
                  key={i}
                  className="flex w-16 shrink-0 flex-col gap-1"
                  title={m.caption}
                >
                  {m.preview ? (
                    <img
                      src={m.preview}
                      alt={m.caption}
                      className="h-24 w-16 rounded border object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-24 w-16 items-center justify-center rounded border text-[10px] text-muted-foreground">
                      {t.status === "running" && i === t.scenes.length - 1
                        ? "now"
                        : "·"}
                    </div>
                  )}
                  <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                    {m.caption}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {t.error ? (
            <p className="text-[11px] break-words text-destructive">
              {t.error}
            </p>
          ) : null}
        </div>
      </MenuTrigger>
      <ContextMenuContent>
        {t.video ? (
          <>
            <ContextMenuItem onClick={openVideo}>
              Open in editor
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => t.video && void revealItemInDir(t.video)}
            >
              Show in Finder
            </ContextMenuItem>
          </>
        ) : null}
        {t.project && t.vsl ? (
          <ContextMenuItem onClick={openVsl}>Open the VSL flow</ContextMenuItem>
        ) : null}
        {t.shot ? (
          <ContextMenuItem
            onClick={() => t.shot && void revealItemInDir(t.shot)}
          >
            Show the failure screenshot
          </ContextMenuItem>
        ) : null}
        {!isFinished(t) ? (
          <ContextMenuItem onClick={() => void cancelTask(t.id)}>
            Stop
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => remove(t.id)}>
              Remove from the list
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function StatusIcon({ status }: { status: Task["status"] }) {
  if (status === "running") return <Spinner className="size-4" />;
  const { icon, cls } =
    status === "done"
      ? { icon: CheckmarkCircle02Icon, cls: "text-emerald-400" }
      : status === "queued"
        ? { icon: Clock01Icon, cls: "text-muted-foreground" }
        : {
            icon: Cancel01Icon,
            cls:
              status === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
          };
  return (
    <HugeiconsIcon icon={icon} size={16} className={cn("shrink-0", cls)} />
  );
}
