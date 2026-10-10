import { viewportFor } from "@goscreen/content-source";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useProject } from "@/modules/studio/store/project";
import { android, useAndroidSettings } from "./provider";

/** Device polling cadence. Detection only: nothing connects by itself. */
const POLL_MS = 3000;

export function useAdbStatus() {
  const adbPath = useAndroidSettings((s) => s.adbPath);
  return useQuery({
    queryKey: ["android", "status", adbPath],
    queryFn: () => android.status(),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAndroidDevices(enabled = true) {
  const adbPath = useAndroidSettings((s) => s.adbPath);
  const status = useAdbStatus();
  return useQuery({
    queryKey: ["android", "devices", adbPath],
    queryFn: () => android.listDevices(),
    enabled: enabled && status.data?.available === true,
    refetchInterval: POLL_MS,
    retry: false,
  });
}

/**
 * Keeps frames backed by an Android device matched to it: the frame takes
 * the real screen ratio and follows rotations done on the device.
 */
export function useAndroidSync() {
  const hasAndroid = useProject((s) =>
    s.devices.some((d) => d.source.kind === "android"),
  );
  const live = useAndroidDevices(hasAndroid);

  useEffect(() => {
    if (!live.data) return;
    const { devices, updateDevice } = useProject.getState();
    for (const d of devices) {
      if (d.source.kind !== "android") continue;
      const serial = d.source.serial;
      const device = live.data.find((x) => x.serial === serial);
      if (!device?.resolution) continue;
      const viewport = viewportFor({
        ...device.resolution,
        density: device.density,
      });
      const same =
        d.viewport?.width === viewport.width &&
        d.viewport?.height === viewport.height &&
        d.orientation === device.orientation;
      if (!same)
        updateDevice(d.id, { viewport, orientation: device.orientation });
    }
  }, [live.data]);
}
