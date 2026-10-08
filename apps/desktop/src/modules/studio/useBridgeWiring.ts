import { useEffect } from "react";
import { normalizeUrl } from "@/lib/url";
import { type BridgeEvent, sendToFrame, subscribeBridge } from "@/modules/interaction/bridge";
import { useRuntime } from "@/modules/interaction/runtime";
import { syncScrollCommand } from "@/modules/interaction/sync";
import { screenUV, toRegionPoint } from "@/modules/recording/stagePoint";
import { interactionLog, useRecording } from "@/modules/recording/store";
import { useEditor } from "./store/editor";
import { useProject } from "./store/project";

export function useBridgeWiring() {
  useEffect(
    () =>
      subscribeBridge((instanceId, event) => {
        const project = useProject.getState();
        const source = project.devices.find((d) => d.id === instanceId);
        if (!source) return;
        if (useRecording.getState().active && event.type !== "location") {
          interactionLog.push({ instanceId, event });
          logPointer(instanceId, source.source.kind, event);
        }

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

const POINTER_KINDS = { pointer: "move", down: "down", up: "up" } as const;

// Pointer events in recording time and stage space, ready for the editor.
function logPointer(instanceId: string, source: "web" | "android", event: BridgeEvent) {
  if (event.type !== "pointer" && event.type !== "down" && event.type !== "up") return;
  const { clockZero, region } = useRecording.getState();
  if (clockZero === null || !region) return;
  const p = toRegionPoint(instanceId, event.x, event.y, region);
  const uv = screenUV(instanceId, event.x, event.y);
  if (!p) return;
  interactionLog.pushPointer({
    t: (performance.now() - clockZero) / 1000,
    kind: POINTER_KINDS[event.type],
    x: p.x,
    y: p.y,
    ...(uv ? { u: uv.x, v: uv.y } : {}),
    instanceId,
    source,
  });
}
