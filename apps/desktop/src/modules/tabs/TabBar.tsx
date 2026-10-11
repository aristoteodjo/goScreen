import {
  Add01Icon,
  Cancel01Icon,
  Folder01Icon,
  Home01Icon,
  Video01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { MenuTrigger } from "@/lib/menu";
import { cn } from "@/lib/utils";
import { bindTabs, type TabKind, useTabs } from "./tabs";

const ICONS: Record<TabKind, typeof Home01Icon> = {
  home: Home01Icon,
  project: Folder01Icon,
  flow: WorkflowSquare01Icon,
  editor: Video01Icon,
  studio: Video01Icon,
};

/** The tab strip at the top of the window, where the traffic lights sit. */
export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => bindTabs(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { tabs, active, open, activate } = useTabs.getState();
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        open("/", { reuse: false });
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === active);
        const next = (i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
        activate(tabs[next].id);
      } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
        const tab = tabs[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          activate(tab.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav
      data-tauri-drag-region
      data-ai="tabs"
      aria-label="Tabs"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto bg-[oklch(0.11_0.003_260)] pr-72 pl-20 [scrollbar-width:none]"
    >
      {tabs.map((t, i) => {
        const on = t.id === active;
        return (
          <ContextMenu key={t.id}>
            <MenuTrigger>
              <div
                role="tab"
                tabIndex={0}
                aria-selected={on}
                draggable
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (!dragging || dragging === t.id) return;
                  e.preventDefault();
                  useTabs.getState().move(dragging, i);
                }}
                onClick={() => useTabs.getState().activate(t.id)}
                onKeyDown={(e) =>
                  e.key === "Enter" && useTabs.getState().activate(t.id)
                }
                onAuxClick={(e) =>
                  e.button === 1 && useTabs.getState().close(t.id)
                }
                title={t.title}
                className={cn(
                  "group flex h-8 max-w-52 min-w-28 shrink-0 cursor-default items-center gap-1.5 rounded-t-md px-2.5 text-[12px]",
                  on
                    ? "bg-[oklch(0.13_0.004_260)] text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={ICONS[t.kind]}
                  size={13}
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useTabs.getState().close(t.id);
                  }}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded hover:bg-white/15",
                    on ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                  )}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} />
                </button>
              </div>
            </MenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem
                onClick={() =>
                  useTabs.getState().open(t.href, { reuse: false })
                }
              >
                Duplicate tab
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => useTabs.getState().close(t.id)}>
                Close tab
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const { tabs, close, activate } = useTabs.getState();
                  activate(t.id);
                  for (const o of tabs) if (o.id !== t.id) close(o.id);
                }}
              >
                Close other tabs
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <button
        type="button"
        aria-label="New tab (⌘ T)"
        title="New tab (⌘ T)"
        onClick={() => useTabs.getState().open("/", { reuse: false })}
        className="mb-1 ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={13} />
      </button>
      <div data-tauri-drag-region className="h-full flex-1" />
    </nav>
  );
}
