import { useEffect } from "react";
import { create } from "zustand";
import { router } from "@/lib/router";

// Tabs, browser style: each keeps the place it shows (a project, a flow, a
// video in the editor...). Navigating moves the active tab; a new tab
// opens next to it. Places are restored on launch; the edits themselves
// live on disk.

import { describe, type Tab, type TabKind } from "./place";

export type { Tab, TabKind };

const KEY = "goscreen.tabs";

const newTab = (href: string): Tab => ({
  id: crypto.randomUUID(),
  href,
  ...describe(href),
});

function restore(): { tabs: Tab[]; active: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      raw &&
      Array.isArray(raw.tabs) &&
      raw.tabs.length > 0 &&
      raw.tabs.every(
        (t: Tab) => typeof t?.id === "string" && typeof t?.href === "string",
      )
    ) {
      const tabs = (raw.tabs as Tab[]).map((t) => ({
        ...describe(t.href),
        ...t,
      }));
      const active = tabs.some((t) => t.id === raw.active)
        ? raw.active
        : tabs[0].id;
      return { tabs, active };
    }
  } catch {}
  const first = newTab("/");
  return { tabs: [first], active: first.id };
}

type TabsStore = {
  tabs: Tab[];
  active: string;
  /** Opens a place in a new tab, or brings forward the tab showing it. */
  open: (href: string, options?: { reuse?: boolean }) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  move: (id: string, to: number) => void;
  // Called on every navigation: the active tab follows.
  follow: (href: string) => void;
  rename: (href: string, title: string) => void;
};

export const useTabs = create<TabsStore>((set, get) => ({
  ...restore(),
  open: (href, { reuse = true } = {}) => {
    const existing = reuse ? get().tabs.find((t) => t.href === href) : null;
    if (existing) {
      get().activate(existing.id);
      return;
    }
    const tab = newTab(href);
    const { tabs, active } = get();
    const at = tabs.findIndex((t) => t.id === active) + 1;
    set({
      tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)],
      active: tab.id,
    });
    void router.navigate({ href });
  },
  activate: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set({ active: id });
    if (router.state.location.href !== tab.href)
      void router.navigate({ href: tab.href });
  },
  close: (id) => {
    const { tabs, active } = get();
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) {
      const home = newTab("/");
      set({ tabs: [home], active: home.id });
      void router.navigate({ href: "/" });
      return;
    }
    set({ tabs: rest });
    if (id === active) get().activate(rest[Math.min(i, rest.length - 1)].id);
  },
  move: (id, to) => {
    const tabs = [...get().tabs];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, tab);
    set({ tabs });
  },
  follow: (href) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== s.active || t.href === href) return t;
        const d = describe(href);
        // A new place keeps its first name until its page names it.
        return { ...t, href, kind: d.kind, title: d.title };
      }),
    })),
  rename: (href, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.href === href && t.title !== title ? { ...t, title } : t,
      ),
    })),
}));

useTabs.subscribe((s) => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: s.tabs, active: s.active }),
    );
  } catch {}
});

/** Opens a route in a tab (the one already showing it, else a new one). */
export function openPlace(
  to: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  },
  options?: { reuse?: boolean },
) {
  // Routes are checked where they are declared; here any place goes.
  const href = router.buildLocation(to as never).href;
  useTabs.getState().open(href, options);
}

/** Pages name their tab (a project's name rather than its id). */
export function useTabTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    useTabs.getState().rename(router.state.location.href, title);
  }, [title]);
}

/** Keeps the active tab on the current place; restores it on launch. */
export function bindTabs() {
  const { tabs, active } = useTabs.getState();
  const tab = tabs.find((t) => t.id === active);
  if (tab && router.state.location.href !== tab.href)
    void router.navigate({ href: tab.href, replace: true });
  return router.subscribe("onResolved", ({ toLocation }) => {
    useTabs.getState().follow(toLocation.href);
  });
}
