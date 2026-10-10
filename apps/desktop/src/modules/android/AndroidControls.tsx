import {
  type AndroidKey,
  describeAndroidError,
  toAndroidError,
} from "@goscreen/android-source";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { android } from "./provider";
import { useAndroidDevices } from "./useAndroid";

const KEYS: { key: AndroidKey; label: string }[] = [
  { key: "back", label: "Back" },
  { key: "home", label: "Home" },
  { key: "recents", label: "Recents" },
];

// Inspector block for a frame showing a live Android device.
export function AndroidControls({ serial }: { serial: string }) {
  const live = useAndroidDevices().data?.find((d) => d.serial === serial);
  const press = useMutation({
    mutationFn: (key: AndroidKey) =>
      android.input(serial, { kind: "key", key }),
    onError: (e) => {
      const err = toAndroidError(e);
      toast.error(err.message, {
        description: describeAndroidError(err.code).hints.join(" "),
      });
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background/40 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Android source</span>
        <span
          className={live?.connected ? "text-emerald-400" : "text-amber-400"}
        >
          {live?.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="truncate font-medium">{live?.name ?? serial}</p>
      {live?.resolution ? (
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {live.resolution.width} × {live.resolution.height}
          {live.density ? ` · ${live.density} dpi` : ""} · {live.orientation}
        </p>
      ) : null}
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {KEYS.map((k) => (
          <Button
            key={k.key}
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            disabled={!live?.connected}
            onClick={() => press.mutate(k.key)}
          >
            {k.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Rotate the emulator itself; the frame follows. Pick any frame above, the
        app stays the same.
      </p>
    </div>
  );
}
