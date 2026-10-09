import type { CaptureControls } from "@/modules/recording/useCapture";
import { selectCaptureMode, useCaptureSettings } from "@/modules/recording/settings";
import { useEditor } from "./store/editor";
import { useProject } from "./store/project";

// Quick actions shared by context menus, the command palette and shortcuts.
// The capture controls live in the studio route; it binds them here so a
// menu deep in the tree can trigger a screenshot without prop drilling.
let capture: CaptureControls | null = null;

export function bindCapture(controls: CaptureControls | null) {
  capture = controls;
}

export const studioActions = {
  /** Opens the capture bar on the selected device only. */
  recordDevice(id: string) {
    useEditor.getState().select(id);
    selectCaptureMode("device");
    useCaptureSettings.getState().setBarOpen(true);
  },
  /** Opens the capture bar on the current view (Canvas or Scene). */
  recordView() {
    selectCaptureMode(useEditor.getState().view);
    useCaptureSettings.getState().setBarOpen(true);
  },
  screenshotDevice(id: string) {
    useEditor.getState().select(id);
    selectCaptureMode("device");
    capture?.screenshot();
  },
  screenshotView() {
    selectCaptureMode(useEditor.getState().view);
    capture?.screenshot();
  },
  duplicate(id: string) {
    const project = useProject.getState();
    const d = project.devices.find((x) => x.id === id);
    if (!d) return;
    const copy = project.addDevice(d.deviceId, { source: d.source, viewport: d.viewport, orientation: d.orientation });
    if (!copy) return;
    project.updateDevice(copy, {
      colorId: d.colorId,
      synced: d.synced,
      url: d.url,
      statusBar: d.statusBar,
      renderMode: d.renderMode,
      shadow: d.shadow,
    });
    useEditor.getState().select(copy);
  },
  rotate(id: string) {
    const d = useProject.getState().devices.find((x) => x.id === id);
    if (d?.source.kind !== "web") return;
    useProject.getState().updateDevice(id, { orientation: d.orientation === "portrait" ? "landscape" : "portrait" });
  },
  remove(id: string) {
    if (useEditor.getState().selectedId === id) useEditor.getState().select(null);
    useProject.getState().removeDevice(id);
  },
};
