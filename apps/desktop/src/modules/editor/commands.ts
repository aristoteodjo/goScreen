import { placeZoom, sourceTimeAt } from "@goscreen/render-engine";
import { editActions } from "./actions";
import { player } from "./session";
import { useEdit, usePlayback } from "./store";

const FRAME = 1 / 30;

export type EditorCommand = {
  id: string;
  group: "Playback" | "Edit" | "Add" | "Zoom";
  label: string;
  shortcut?: string;
  run: () => void;
};

function addZoomAtPlayhead() {
  const { time, duration, selectZoom } = usePlayback.getState();
  // Zooms live in source time; there is none to add over a slide.
  const s = sourceTimeAt(useEdit.getState().edit.clips, time);
  if (s === null) return;
  const slot = placeZoom(useEdit.getState().edit.zooms, s, duration);
  if (!slot) return;
  const id = `zoom-${Date.now().toString(36)}`;
  useEdit.getState().change((ed) => ({ ...ed, zooms: [...ed.zooms, { id, ...slot, scale: 2, focus: null }] }));
  selectZoom(id);
}

function deleteSelected() {
  if (editActions.deleteSelection()) return;
  const { selectedZoom, selectZoom } = usePlayback.getState();
  if (!selectedZoom) return;
  useEdit.getState().change((ed) => ({ ...ed, zooms: ed.zooms.filter((z) => z.id !== selectedZoom) }));
  selectZoom(null);
}

export function editorCommands(openExport: () => void): EditorCommand[] {
  return [
    { id: "play", group: "Playback", label: "Play / pause", shortcut: "Space", run: player.toggle },
    { id: "first", group: "Playback", label: "Go to first frame", shortcut: "⌘ ←", run: player.first },
    { id: "last", group: "Playback", label: "Go to last frame", shortcut: "⌘ →", run: player.last },
    { id: "back", group: "Playback", label: "Move backwards", shortcut: "←", run: () => player.step(-FRAME) },
    { id: "back-fast", group: "Playback", label: "Move backwards fast", shortcut: "⇧ ←", run: () => player.step(-1) },
    { id: "fwd", group: "Playback", label: "Move forwards", shortcut: "→", run: () => player.step(FRAME) },
    { id: "fwd-fast", group: "Playback", label: "Move forwards fast", shortcut: "⇧ →", run: () => player.step(1) },
    { id: "undo", group: "Edit", label: "Undo", shortcut: "⌘ Z", run: () => useEdit.getState().undo() },
    { id: "redo", group: "Edit", label: "Redo", shortcut: "⇧ ⌘ Z", run: () => useEdit.getState().redo() },
    { id: "split", group: "Edit", label: "Split at playhead", shortcut: "S", run: editActions.splitAtPlayhead },
    { id: "duplicate", group: "Edit", label: "Duplicate selection", shortcut: "⌘ D", run: () => editActions.duplicate() },
    { id: "delete", group: "Edit", label: "Delete selection", shortcut: "⌫", run: deleteSelected },
    { id: "add-text", group: "Add", label: "Add text", shortcut: "T", run: () => editActions.addText() },
    { id: "add-slide", group: "Add", label: "Add slide at playhead", run: editActions.addSlide },
    { id: "add-media", group: "Add", label: "Add image or video…", run: () => void editActions.importMedia(["image", "video"]) },
    { id: "add-music", group: "Add", label: "Add music…", run: () => void editActions.importMedia(["audio"]) },
    { id: "export", group: "Edit", label: "Export MP4", shortcut: "⌘ E", run: openExport },
    { id: "zoom-add", group: "Zoom", label: "Add zoom at playhead", shortcut: "Z", run: addZoomAtPlayhead },
    {
      id: "zoom-clear",
      group: "Zoom",
      label: "Remove all zooms",
      run: () => {
        useEdit.getState().change((ed) => ({ ...ed, zooms: [] }));
        usePlayback.getState().selectZoom(null);
      },
    },
  ];
}

/** Keyboard event -> command id. Inputs keep their own keys. */
export function commandForKey(e: KeyboardEvent): string | null {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable=true], [role=slider]")) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && key === "e") return "export";
  if (mod && key === "d") return "duplicate";
  if (mod && key === "arrowleft") return "first";
  if (mod && key === "arrowright") return "last";
  if (mod) return null;
  if (key === " ") return "play";
  if (key === "arrowleft") return e.shiftKey ? "back-fast" : "back";
  if (key === "arrowright") return e.shiftKey ? "fwd-fast" : "fwd";
  if (key === "z") return "zoom-add";
  if (key === "s") return "split";
  if (key === "t") return "add-text";
  if (key === "backspace" || key === "delete") return "delete";
  return null;
}
