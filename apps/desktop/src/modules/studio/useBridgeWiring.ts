import { useEffect } from "react";
import { normalizeUrl } from "@/lib/url";
import { sendToFrame, subscribeBridge } from "@/modules/interaction/bridge";
import { useRuntime } from "@/modules/interaction/runtime";
import { syncScrollCommand } from "@/modules/interaction/sync";
import { interactionLog, useRecording } from "@/modules/recording/store";
import { useEditor } from "./store/editor";
import { useProject } from "./store/project";

export function useBridgeWiring() {
  useEffect(
    () =>
      subscribeBridge((instanceId, event) => {
        if (useRecording.getState().active && event.type !== "location") {
          interactionLog.push({ instanceId, event });
        }
        const project = useProject.getState();
        const source = project.devices.find((d) => d.id === instanceId);
        if (!source) return;

        switch (event.type) {
          case "down":
            useEditor.getState().select(instanceId);
            break;
          case "scroll": {
            if (!source.synced) break;
            const command = syncScrollCommand(event);
            for (const d of project.devices) {
              if (d.id !== instanceId && d.synced) sendToFrame(d.id, command);
            }
            break;
          }
          case "navigate": {
            const url = normalizeUrl(event.href);
            if (url) project.navigateDevice(instanceId, url);
            break;
          }
          case "location": {
            useRuntime.getState().setLocation(instanceId, event.href, event.title);
            // SPA route changes the user caused are mirrored; load-time
            // redirects are not, or differently redirected devices would loop.
            if (event.cause === "history" && event.user) {
              const url = normalizeUrl(event.href);
              if (url) project.navigateDevice(instanceId, url);
            }
            break;
          }
        }
      }),
    [],
  );
}
