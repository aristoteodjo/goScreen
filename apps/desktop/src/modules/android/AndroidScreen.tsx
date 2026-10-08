import {
  type AndroidInput,
  type AndroidSourceError,
  describeAndroidError,
  gestureFrom,
  toAndroidError,
} from "@goscreen/android-source";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { emitLocal } from "@/modules/interaction/bridge";
import { android } from "./provider";
import { useAndroidDevices } from "./useAndroid";

type Props = {
  instanceId: string;
  serial: string;
  interactive: boolean;
};

type Stream = { url: string } | { error: AndroidSourceError } | null;

type Press = { x: number; y: number; t: number };

// Opens a stream for as long as the frame is mounted. The Rust side tears
// adb and ffmpeg down when this image disconnects.
function useStream(serial: string, attempt: number): Stream {
  const [stream, setStream] = useState<Stream>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    let alive = true;
    let sessionId: string | null = null;
    setStream(null);
    android
      .startCapture(serial)
      .then((s) => {
        if (!alive) {
          void android.stopCapture(s.sessionId).catch(() => {});
          return;
        }
        sessionId = s.sessionId;
        setStream({ url: s.url });
      })
      .catch((e) => alive && setStream({ error: toAndroidError(e) }));
    return () => {
      alive = false;
      if (sessionId) void android.stopCapture(sessionId).catch(() => {});
    };
  }, [serial, attempt]);
  return stream;
}

export function AndroidScreen({ instanceId, serial, interactive }: Props) {
  const [attempt, setAttempt] = useState(0);
  const stream = useStream(serial, attempt);
  const live = useAndroidDevices().data?.find((d) => d.serial === serial);
  const press = useRef<Press | null>(null);

  const input = useMutation({
    mutationFn: (action: AndroidInput) => android.input(serial, action),
    onError: (e) => {
      const err = toAndroidError(e);
      toast.error(err.message, { description: describeAndroidError(err.code).hints.join(" ") });
    },
  });

  const local = (e: PointerEvent<HTMLDivElement>) => ({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, t: Date.now() });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    press.current = p;
    emitLocal(instanceId, { type: "down", ...p });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    emitLocal(instanceId, { type: "pointer", ...local(e) });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const down = press.current;
    press.current = null;
    if (!down) return;
    const up = local(e);
    emitLocal(instanceId, { type: "up", ...up });
    if (!live?.resolution) return;
    const el = e.currentTarget;
    input.mutate(gestureFrom(down, up, { width: el.clientWidth, height: el.clientHeight }, live.resolution));
  };

  const gone = live === undefined || !live.connected;

  return (
    <div
      className={cn("relative h-full w-full bg-black", !interactive && "pointer-events-none")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
      }}
    >
      {stream && "url" in stream ? (
        <img
          key={stream.url}
          src={stream.url}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-fill select-none"
        />
      ) : null}
      {stream === null ? <Overlay message="Connecting to Android" /> : null}
      {stream && "error" in stream ? (
        <Overlay error={stream.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : gone && stream ? (
        <Overlay error={toAndroidError({ code: "disconnected", detail: serial })} onRetry={() => setAttempt((n) => n + 1)} />
      ) : null}
    </div>
  );
}

function Overlay({ message, error, onRetry }: { message?: string; error?: AndroidSourceError; onRetry?: () => void }) {
  const info = error ? describeAndroidError(error.code) : null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/90 px-8 text-center text-neutral-300">
      {error ? <HugeiconsIcon icon={Alert02Icon} size={28} strokeWidth={1.5} /> : <Spinner className="size-6" />}
      <p className="text-[15px] leading-snug">{info?.title ?? message}</p>
      {info && info.hints.length > 0 ? (
        <ul className="space-y-1 text-[13px] text-neutral-400">
          {info.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="secondary" onPointerDown={(e) => e.stopPropagation()} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
