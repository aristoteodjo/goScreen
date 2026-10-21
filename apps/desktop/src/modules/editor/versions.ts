import {
  type EditAuthor,
  type EditState,
  type EditVersion,
  type EditVersionMeta,
  parseEditState,
  pruneHistory,
} from "@goscreen/render-engine";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { useSession } from "./session";
import { useEdit } from "./store";

// Versions of a montage, the shell side: when one is written (AI command,
// explicit save, coalesced autosave, restore), how it is read back and
// applied. The diff and the pruning rules are pure (render-engine).

/** An autosave version at most this often; leaving the editor writes one anyway. */
export const AUTOSAVE_VERSION_MS = 30_000;

export const versionsKey = (videoPath: string) => ["edit-versions", videoPath];

export function newVersionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`.toLowerCase();
}

export const listVersions = (videoPath: string) =>
  ipc.editVersionsList(videoPath);

export function useVersions(videoPath: string | null) {
  return useQuery({
    queryKey: versionsKey(videoPath ?? ""),
    queryFn: () => listVersions(videoPath ?? ""),
    enabled: videoPath !== null,
  });
}

export async function readVersion(
  videoPath: string,
  id: string,
): Promise<EditVersion> {
  const raw = (await ipc.editVersionGet(videoPath, id)) as {
    state?: unknown;
  } & EditVersionMeta;
  const state = parseEditState(raw.state);
  if (!state) throw new Error(`Version ${id} holds no readable montage.`);
  const { state: _state, ...meta } = raw;
  return { ...meta, state };
}

export async function latestVersion(
  videoPath: string,
): Promise<EditVersion | null> {
  const all = await listVersions(videoPath);
  const last = all[all.length - 1];
  return last ? readVersion(videoPath, last.id) : null;
}

/** The montage as the person sees it (open in the editor), else as saved. */
export async function currentEditOf(
  videoPath: string,
): Promise<EditState | null> {
  if (useSession.getState().videoPath === videoPath)
    return useEdit.getState().edit;
  const opened = await ipc.recordingOpen(videoPath);
  return parseEditState(opened.edit);
}

/** Applies a state: an undoable change when the video is open, else to disk. */
export async function applyState(
  videoPath: string,
  state: EditState,
  key = "ai",
) {
  if (useSession.getState().videoPath === videoPath)
    useEdit.getState().change(() => state, key);
  else await ipc.editSave(videoPath, state);
}

// The state each video's latest version holds, to skip versions that would
// repeat it (JSON, compared as text).
const lastWritten = new Map<string, string>();

async function lastWrittenJson(videoPath: string): Promise<string | null> {
  const cached = lastWritten.get(videoPath);
  if (cached !== undefined) return cached;
  const latest = await latestVersion(videoPath).catch(() => null);
  const json = latest ? JSON.stringify(latest.state) : "";
  lastWritten.set(videoPath, json);
  return json || null;
}

/** Writes a version, prunes the journal and refreshes the panel. */
export async function recordVersion(
  videoPath: string,
  v: {
    author: EditAuthor;
    command?: string;
    message?: string;
    state: EditState;
  },
): Promise<EditVersionMeta> {
  const version: EditVersion = {
    id: newVersionId(),
    at: new Date().toISOString(),
    author: v.author,
    ...(v.command ? { command: v.command } : {}),
    ...(v.message ? { message: v.message } : {}),
    state: v.state,
  };
  const meta = await ipc.editVersionWrite(videoPath, version);
  lastWritten.set(videoPath, JSON.stringify(v.state));
  const all = await listVersions(videoPath);
  const { drop } = pruneHistory(all, Date.now());
  for (const d of drop)
    await ipc.editVersionDelete(videoPath, d.id).catch(() => {});
  await queryClient.invalidateQueries({ queryKey: versionsKey(videoPath) });
  return meta;
}

/** An autosave of `state`, unless the latest version already holds it. */
export async function snapshotIfChanged(
  videoPath: string,
  state: EditState | null,
): Promise<EditVersionMeta | null> {
  if (!state) return null;
  const json = JSON.stringify(state);
  if ((await lastWrittenJson(videoPath)) === json) return null;
  return recordVersion(videoPath, { author: "person", state });
}

const lastAutosaveAt = new Map<string, number>();

/** Called after each autosave to disk: a version now and then, or when leaving. */
export async function autosaveVersion(
  videoPath: string,
  state: EditState,
  force = false,
) {
  const now = Date.now();
  const last = lastAutosaveAt.get(videoPath) ?? 0;
  if (!force && now - last < AUTOSAVE_VERSION_MS) return;
  lastAutosaveAt.set(videoPath, now);
  await snapshotIfChanged(videoPath, state);
}

/** Loads a version as an undoable change and notes the restore itself. */
export async function restoreVersion(
  videoPath: string,
  id: string,
): Promise<EditVersionMeta> {
  const version = await readVersion(videoPath, id);
  await snapshotIfChanged(videoPath, await currentEditOf(videoPath));
  await applyState(videoPath, version.state, "restore");
  return recordVersion(videoPath, {
    author: "person",
    command: "restore",
    message: `Restored ${version.message ?? version.command ?? "autosave"} (${new Date(version.at).toLocaleString()})`,
    state: version.state,
  });
}

/** A new montage from this one (video linked, sidecars and versions copied). */
export async function duplicateMontage(
  videoPath: string,
  name: string | null,
): Promise<string> {
  // What is still waiting in the editor goes to disk first.
  if (useSession.getState().videoPath === videoPath)
    await ipc.editSave(videoPath, useEdit.getState().edit);
  return ipc.editDuplicate(videoPath, name);
}

// Editor UI: the prompt for a version's message (⌘S) or a copy's name.
export type VersionPrompt = "save" | "duplicate" | null;
type VersionsUi = {
  prompt: VersionPrompt;
  setPrompt: (prompt: VersionPrompt) => void;
};
export const useVersionsUi = create<VersionsUi>((set) => ({
  prompt: null,
  setPrompt: (prompt) => set({ prompt }),
}));
