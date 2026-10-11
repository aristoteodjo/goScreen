import { Mic01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCaptureSettings } from "@/modules/recording/settings";
import { addVoiceOver } from "./actions";
import { player, setMonitorMuted, useSession } from "./session";
import { timelineEnd, useEdit, usePlayback } from "./store";

// Voice-over, Premiere style: a 3-2-1 pre-roll, then the timeline plays
// (speakers off, so they do not bleed into the mic) while the voice records;
// stop with the button, Space or at the end. The take lands at the playhead.

type Phase = "idle" | "countdown" | "recording" | "saving";

type VoiceOver = {
  phase: Phase;
  count: number;
  start: number;
  mic: string;
};

export const useVoiceOver = create<VoiceOver>(() => ({
  phase: "idle",
  count: 0,
  start: 0,
  mic: "",
}));

const PRE_ROLL = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const set = useVoiceOver.setState;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// File time at which the timeline started playing, and when it did.
let take = { fileAt: 0, wall: 0 };
let unwatch: (() => void) | null = null;

async function pickMicrophone() {
  const devices = await ipc.captureDevices();
  const wanted = useCaptureSettings.getState().microphone;
  const mics = devices.microphones;
  return mics.find((m) => m.name === wanted) ?? mics[0] ?? null;
}

export async function startVoiceOver() {
  if (useVoiceOver.getState().phase !== "idle") return;
  const { videoPath } = useSession.getState();
  if (!videoPath) return;
  const end = timelineEnd(useEdit.getState().edit);
  if (usePlayback.getState().time >= end - 0.2) player.seek(0);
  player.pause();
  let mic: Awaited<ReturnType<typeof pickMicrophone>>;
  try {
    mic = await pickMicrophone();
  } catch (e) {
    toast.error("Microphones could not be listed", { description: message(e) });
    return;
  }
  if (!mic) {
    toast.error("No microphone found.");
    return;
  }
  set({ phase: "countdown", count: PRE_ROLL, mic: mic.name });
  // The mic warms up during the pre-roll.
  const started = ipc
    .voiceOverStart(videoPath, mic.index)
    .then((r) => ({ lead: r.lead, wall: performance.now() }));
  for (let n = PRE_ROLL; n > 0; n -= 1) {
    set({ count: n });
    await sleep(1000);
    if (useVoiceOver.getState().phase !== "countdown") {
      started.then(() => ipc.voiceOverCancel()).catch(() => {});
      return;
    }
  }
  let ready: { lead: number; wall: number };
  try {
    ready = await started;
  } catch (e) {
    set({ phase: "idle" });
    toast.error("The voice-over could not start", { description: message(e) });
    return;
  }
  if (useVoiceOver.getState().phase !== "countdown") {
    void ipc.voiceOverCancel().catch(() => {});
    return;
  }
  setMonitorMuted(true);
  const start = usePlayback.getState().time;
  take = {
    fileAt: ready.lead + (performance.now() - ready.wall) / 1000,
    wall: performance.now(),
  };
  set({ phase: "recording", start });
  player.play();
  // The end of the timeline stops the take too.
  unwatch = usePlayback.subscribe((s, prev) => {
    if (prev.playing && !s.playing) void stopVoiceOver();
  });
}

export async function stopVoiceOver() {
  const { phase, start } = useVoiceOver.getState();
  if (phase === "countdown") {
    set({ phase: "idle" });
    return;
  }
  if (phase !== "recording") return;
  unwatch?.();
  unwatch = null;
  const length = (performance.now() - take.wall) / 1000;
  player.pause();
  setMonitorMuted(false);
  set({ phase: "saving" });
  try {
    const result = await ipc.voiceOverStop();
    addVoiceOver(result.asset, {
      start,
      in: take.fileAt,
      duration: Math.min(length, timelineEnd(useEdit.getState().edit) - start),
    });
    if (result.silent)
      toast.warning("The voice-over is silent", {
        description:
          "This microphone recorded no sound. Choose another one in the studio's capture bar.",
      });
    else toast.success("Voice-over added");
  } catch (e) {
    toast.error("The voice-over could not be saved", {
      description: message(e),
    });
  } finally {
    set({ phase: "idle" });
  }
}

export function cancelVoiceOver() {
  const { phase } = useVoiceOver.getState();
  if (phase === "idle" || phase === "saving") return;
  unwatch?.();
  unwatch = null;
  player.pause();
  setMonitorMuted(false);
  set({ phase: "idle" });
  void ipc.voiceOverCancel().catch(() => {});
}

/** The record button of an audio track header. */
export function VoiceOverButton({ className }: { className?: string }) {
  const phase = useVoiceOver((s) => s.phase);
  const busy = phase !== "idle";
  return (
    <button
      type="button"
      aria-label={busy ? "Stop the voice-over" : "Record a voice-over"}
      title={
        busy
          ? "Stop the voice-over (Space)"
          : "Record a voice-over from the playhead"
      }
      onClick={() => void (busy ? stopVoiceOver() : startVoiceOver())}
      className={cn(
        "flex size-5 items-center justify-center rounded hover:bg-white/10",
        busy ? "text-rose-400" : "text-muted-foreground",
        className,
      )}
    >
      <HugeiconsIcon icon={busy ? StopIcon : Mic01Icon} size={12} />
    </button>
  );
}

/** Over the program monitor: the pre-roll count, then a recording badge. */
export function VoiceOverOverlay() {
  const phase = useVoiceOver((s) => s.phase);
  const count = useVoiceOver((s) => s.count);
  const mic = useVoiceOver((s) => s.mic);
  const time = usePlayback((s) => s.time);
  const start = useVoiceOver((s) => s.start);
  if (phase === "idle") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      {phase === "countdown" ? (
        <div className="flex size-28 items-center justify-center rounded-full bg-black/60 font-mono text-6xl text-white tabular-nums">
          {count}
        </div>
      ) : null}
      <div className="pointer-events-auto absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 py-1 pr-1 pl-3 text-xs text-white">
        <span
          className={cn(
            "size-2 rounded-full bg-rose-500",
            phase === "recording" && "animate-pulse",
          )}
        />
        {phase === "saving"
          ? "Cleaning the voice…"
          : phase === "countdown"
            ? `Voice-over · ${mic}`
            : `Recording · ${(time - start).toFixed(1)} s`}
        {phase !== "saving" ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-6 rounded-full px-2 text-[11px]"
            onClick={() => void stopVoiceOver()}
          >
            Stop
          </Button>
        ) : null}
      </div>
    </div>
  );
}
