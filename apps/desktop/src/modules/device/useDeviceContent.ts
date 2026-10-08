import type { DeviceDefinition } from "@goscreen/device-registry";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

export function useDeviceContent(url: string, device: DeviceDefinition) {
  const touch = device.category === "phone" || device.category === "tablet";
  return useQuery({
    queryKey: ["proxy", url, device.userAgent, touch],
    queryFn: () => ipc.proxyOpen(url, device.userAgent, touch),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    enabled: url.length > 0,
  });
}
