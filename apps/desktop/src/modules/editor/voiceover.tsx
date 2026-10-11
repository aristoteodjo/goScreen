import {
  ArrowDown01Icon,
  Mic01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCaptureSettings } from "@/modules/recording/settings";
import { addVoiceOver, cleanSilences } from "./actions";
import { player, setMonitorMuted, useSession } from "./session";
import { timelineEnd, useEdit, usePlayback } from "./store";

// Voice-over, Premiere style: a 3-2-1 pre-roll, then the timeline plays
// (speakers off, so they do not bleed into the mic) while the voice records;
// stop with the button, Space or at the end. The take lands at the playhead.

type Phase = "idle" | "checking" | "countdown" | "recording" | "saving";

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

/** The voice-over's own microphone choice (null: the best one that hears). */
export const useVoiceMic = create<{
  name: string | null;
  setName: (name: string | null) => void;
}>()(
  persist((set) => ({ name: null, setName: (name) => set({ name }) }), {
    name: "goscreen.voiceover.mic",
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ name: s.name }),
  }),
);

// Devices meeting and streaming apps install: listed like a mic, but they
// carry no voice unless a call is running (digital silence).
const VIRTUAL =
  /teams|zoom|blackhole|loopback|soundflower|krisp|virtual|aggregate|obs|webex|discord/i;
const BUILT_IN = /macbook|built-in|internal|imac/i;
// Pure digital silence is around -91 dB; a quiet room is near -60.
const LIVE_DB = -85;

type Mic = { index: number; name: string };

/** Microphones in the order to try: the chosen one, built-in, others, virtual last. */
export function rankMicrophones(mics: Mic[], wanted: string | null): Mic[] {
  const score = (m: Mic) =>
    m.name === wanted
      ? 0
      : VIRTUAL.test(m.name)
        ? 3
        : BUILT_IN.test(m.name)
          ? 1
          : 2;
  return [...mics].sort((a, b) => score(a) - score(b) || a.index - b.index);
}

/** The first microphone that actually hears something, and those that did not. */
async function pickMicrophone() {
  const devices = await ipc.captureDevices();
  const wanted =
    useVoiceMic.getState().name ?? useCaptureSettings.getState().microphone;
  const silent: string[] = [];
  for (const mic of rankMicrophones(devices.microphones, wanted)) {
    const db = await ipc.microphoneLevel(mic.name).catch(() => -91);
    if (db > LIVE_DB) return { mic, silent };
    silent.push(mic.name);
  }
  return { mic: null, silent };
}

export async function startVoiceOver() {
  if (useVoiceOver.getState().phase !== "idle") return;
  const { videoPath } = useSession.getState();
  if (!videoPath) return;
  const end = timelineEnd(useEdit.getState().edit);
  if (usePlayback.getState().time >= end - 0.2) player.seek(0);
  player.pause();
  set({ phase: "checking", mic: "" });
  let picked: Awaited<ReturnType<typeof pickMicrophone>>;
  try {
    picked = await pickMicrophone();
  } catch (e) {
    set({ phase: "idle" });
    toast.error("Microphones could not be listed", { description: message(e) });
    return;
  }
  if (useVoiceOver.getState().phase !== "checking") return;
  const { mic, silent } = picked;
  if (!mic) {
    set({ phase: "idle" });
    if (silent.length === 0) {
      toast.error("No microphone is connected.");
      return;
    }
    // Every device silent, the built-in one included: macOS is withholding
    // the microphone, from the app that launched goScreen.
    const app = await ipc.responsibleApp().catch(() => "goScreen");
    toast.error(`macOS gives "${app}" no microphone`, {
      description: `Every microphone recorded silence (${silent.join(", ")}). Allow "${app}" in System Settings, Privacy & Security, Microphone, then quit and reopen it.`,
      duration: 15000,
      action: {
        label: "Open settings",
        onClick: () => void ipc.openPrivacySettings("microphone"),
      },
    });
    return;
  }
  if (silent.length)
    toast.info(`Recording with ${mic.name}`, {
      description: `${silent.join(", ")} heard nothing (a virtual or disconnected device).`,
    });
  set({ phase: "countdown", count: PRE_ROLL, mic: mic.name });
  // The mic warms up during the pre-roll.
  const started = ipc
    .voiceOverStart(videoPath, mic.name)
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
  if (phase === "countdown" || phase === "checking") {
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
    const id = addVoiceOver(result.asset, {
      start,
      in: take.fileAt,
      duration: Math.min(length, timelineEnd(useEdit.getState().edit) - start),
    });
    // The wait before the first word and after the last goes; the voice
    // keeps its place against the picture.
    if (!result.silent) await cleanSilences(id, "trim").catch(() => {});
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
        {phase === "checking"
          ? "Checking the microphone…"
          : phase === "saving"
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

/** Which microphone the voice-over uses. */
export function VoiceOverMicMenu({ className }: { className?: string }) {
  const name = useVoiceMic((s) => s.name);
  const setName = useVoiceMic((s) => s.setName);
  const [mics, setMics] = useState<Mic[] | null>(null);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open)
          ipc
            .captureDevices()
            .then((d) => setMics(d.microphones))
            .catch(() => setMics([]));
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Microphone for voice-overs"
          className={cn(
            "flex h-7 max-w-40 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground",
            className,
          )}
        >
          <span className="truncate">{name ?? "Best microphone"}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            className="shrink-0 opacity-60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64">
        <DropdownMenuLabel>Voice-over microphone</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={name ?? ""}
          onValueChange={(v) => setName(v || null)}
        >
          <DropdownMenuRadioItem value="">
            Best microphone (checked before each take)
          </DropdownMenuRadioItem>
          {(mics ?? []).map((m) => (
            <DropdownMenuRadioItem key={m.index} value={m.name}>
              {m.name}
              {VIRTUAL.test(m.name) ? (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  virtual
                </span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {mics === null ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Looking for microphones…
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
