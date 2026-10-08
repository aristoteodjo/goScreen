import { create } from "zustand";

// Runtime State: live facts reported by the previewed pages.
type RuntimeState = {
  locations: Record<string, { href: string; title: string }>;
  setLocation: (id: string, href: string, title: string) => void;
};

export const useRuntime = create<RuntimeState>((set) => ({
  locations: {},
  setLocation: (id, href, title) =>
    set((s) => ({ locations: { ...s.locations, [id]: { href, title } } })),
}));

type ReloadState = { nonce: number; reloadAll: () => void };

export const useReload = create<ReloadState>((set) => ({
  nonce: 0,
  reloadAll: () => set((s) => ({ nonce: s.nonce + 1 })),
}));
