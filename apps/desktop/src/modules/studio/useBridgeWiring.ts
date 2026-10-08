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
        switch (event.type) {
          case "down":
            useEditor.getState().select(instanceId);
            break;
          case "scroll": {
            const { syncInteractions, devices } = useProject.getState();
            if (!syncInteractions) break;
            const command = syncScrollCommand(event);
            for (const d of devices) if (d.id !== instanceId) sendToFrame(d.id, command);
            break;
          }
          case "navigate": {
            const url = normalizeUrl(event.href);
            if (url) useProject.getState().setUrl(url);
            break;
          }
          case "location":
            useRuntime.getState().setLocation(instanceId, event.href, event.title);
            break;
        }
      }),
    [],
  );
}
