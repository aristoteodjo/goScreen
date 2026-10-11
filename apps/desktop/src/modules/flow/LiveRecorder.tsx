import {
  compileFlow,
  type Flow,
  pathTo,
  resolveVars,
  type Step,
  stepLabel,
  stepSchema,
  type Target,
} from "@goscreen/scenario";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Cursor01Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen } from "@tauri-apps/api/event";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { deviceFor } from "@/modules/tasks/queue";
import { valuesKey, valuesOf } from "./runs";
import { flowActions, useFlowDoc } from "./store";

// Record a node's steps on the real site: the page plays the journey up to
// this node, then shows live. Every click, typing or scroll happens on the
// site and comes back as a step whose target the runner found by itself.

const box = z.object({
  u: z.number(),
  v: z.number(),
  w: z.number(),
  h: z.number(),
});
const found = z
  .object({
    target: z.record(z.string(), z.unknown()),
    editable: z.boolean(),
    checkable: z.boolean(),
    box,
  })
  .nullable();
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), index: z.number(), total: z.number() }),
  z.object({ type: z.literal("preview"), jpeg: z.string() }),
  z.object({ type: z.literal("frame"), jpeg: z.string(), url: z.string() }),
  z.object({ type: z.literal("ready"), url: z.string() }),
  z.object({ type: z.literal("inspect"), id: z.number().optional(), found }),
  z.object({ type: z.literal("picked"), found: found.unwrap() }),
  z.object({ type: z.literal("recorded"), step: z.unknown() }),
  z.object({ type: z.literal("warn"), message: z.string() }),
  z.object({ type: z.literal("done") }).passthrough(),
  z.object({ type: z.literal("error"), message: z.string() }).passthrough(),
]);

type Found = z.infer<typeof found>;
type Phase = "starting" | "replaying" | "live" | "closed";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LiveRecorder({
  project,
  vsl,
}: {
  project: string;
  vsl: string;
}) {
  const nodeId = useFlowDoc((s) => s.live);
  const flow = useFlowDoc((s) => s.flow);
  if (!nodeId || !flow) return null;
  return (
    <Live
      key={nodeId}
      nodeId={nodeId}
      flow={flow}
      project={project}
      vsl={vsl}
    />
  );
}

function Live({
  nodeId,
  flow,
  project,
  vsl,
}: {
  nodeId: string;
  flow: Flow;
  project: string;
  vsl: string;
}) {
  const node = flow.nodes.find((n) => n.id === nodeId);
  const device = deviceFor({
    ...flow.start,
    version: 1,
    name: flow.name,
    steps: [],
  });
  const [phase, setPhase] = useState<Phase>("starting");
  const [progress, setProgress] = useState({ index: 0, total: 0 });
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [address, setAddress] = useState("");
  const [hover, setHover] = useState<Found>(null);
  const [picked, setPicked] = useState<NonNullable<Found> | null>(null);
  const [field, setField] = useState<Target | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"act" | "pick">("act");
  const [notes, setNotes] = useState<string[]>([]);
  const [rememberAs, setRememberAs] = useState("value");
  const inspectId = useRef(0);
  const lastInspect = useRef(0);
  const wheel = useRef({
    dy: 0,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
  });
  const values = valuesOf(valuesKey(project, vsl));

  const close = useCallback(() => {
    void ipc.liveStop().catch(() => {});
    useFlowDoc.getState().setLive(null);
  }, []);

  const append = useCallback(
    (step: Step) => {
      const current =
        useFlowDoc.getState().flow?.nodes.find((n) => n.id === nodeId)?.steps ??
        [];
      flowActions.setSteps(nodeId, [...current, step]);
    },
    [nodeId],
  );

  // Start: replay the journey up to this node (its own steps included).
  // Starts once per node: later edits of the flow must not restart it, so
  // the flow and the values are read from the stores here.
  useEffect(() => {
    const flow = useFlowDoc.getState().flow;
    if (!flow) return;
    const values = valuesOf(valuesKey(project, vsl));
    const device = deviceFor({
      ...flow.start,
      version: 1,
      name: flow.name,
      steps: [],
    });
    const path = pathTo(flow, nodeId);
    if (!path) {
      toast.error("Link this node to Start first.");
      useFlowDoc.getState().setLive(null);
      return;
    }
    const resolved = resolveVars(compileFlow(flow, [path]).scenario, values);
    if (!resolved.ok) {
      toast.error(`Fill in the values first: ${resolved.missing.join(", ")}.`);
      useFlowDoc.getState().setLive(null);
      return;
    }
    let unlisten: (() => void) | null = null;
    let alive = true;
    let started = false;
    // Deferred: React's development double mount would otherwise open two
    // pages, and the second would fail with "already open".
    const start = setTimeout(async () => {
      const stopListening = await listen("scenario-live", (e) => {
        const p = eventSchema.safeParse(e.payload);
        if (!p.success || !alive) return;
        const ev = p.data;
        switch (ev.type) {
          case "step":
            setPhase("replaying");
            setProgress({ index: ev.index, total: ev.total });
            break;
          case "preview":
            setFrame(`data:image/jpeg;base64,${ev.jpeg}`);
            break;
          case "frame":
            setFrame(`data:image/jpeg;base64,${ev.jpeg}`);
            setUrl(ev.url);
            break;
          case "ready":
            setPhase("live");
            setUrl(ev.url);
            setAddress(ev.url);
            break;
          case "inspect":
            if (ev.id === inspectId.current) setHover(ev.found);
            break;
          case "picked":
            setPicked(ev.found);
            if (ev.found.editable) setField(ev.found.target as Target);
            break;
          case "recorded": {
            const step = stepSchema.safeParse(ev.step);
            if (step.success) append(step.data);
            break;
          }
          case "warn":
            setNotes((n) => [ev.message, ...n].slice(0, 4));
            break;
          case "error":
            toast.error(ev.message);
            break;
        }
      });
      if (!alive) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      started = true;
      try {
        const outcome = await ipc.liveStart(
          { scenario: resolved.scenario, device },
          project,
        );
        if (alive && outcome.status === "failed")
          toast.error("The live page stopped", {
            description: outcome.message,
          });
      } catch (e) {
        if (alive)
          toast.error("The live page could not open", {
            description: message(e),
          });
      } finally {
        if (alive) setPhase("closed");
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(start);
      unlisten?.();
      if (started) void ipc.liveStop().catch(() => {});
    };
  }, [nodeId, project, vsl, append]);

  const send = (cmd: Record<string, unknown>) =>
    ipc.liveSend(cmd).catch((e) => toast.error(message(e)));

  const glass = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      u: (e.clientX - r.left) / r.width,
      v: (e.clientY - r.top) / r.height,
    };
  };

  const onMove = (e: MouseEvent<HTMLElement>) => {
    if (phase !== "live" || Date.now() - lastInspect.current < 90) return;
    lastInspect.current = Date.now();
    inspectId.current += 1;
    void send({ cmd: "inspect", id: inspectId.current, ...glass(e) });
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (phase !== "live") return;
    setPicked(null);
    void send({ cmd: "tap", act: mode === "act", ...glass(e) });
  };

  const onWheel = (e: WheelEvent<HTMLElement>) => {
    if (phase !== "live") return;
    // One scroll step per gesture, not one per wheel tick.
    wheel.current.dy += e.deltaY;
    clearTimeout(wheel.current.timer);
    wheel.current.timer = setTimeout(() => {
      const by = Math.round(wheel.current.dy);
      wheel.current.dy = 0;
      if (Math.abs(by) > 20) void send({ cmd: "scroll", by });
    }, 350);
  };

  const fill = (raw: string) =>
    raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) =>
      name === "code"
        ? all
        : (values[name] ?? flow.start.vars[name]?.default ?? all),
    );

  const typeText = () => {
    if (!text) return;
    void send({
      cmd: "type",
      text,
      value: fill(text),
      ...(field ? { target: field, clear: true } : {}),
    });
    setText("");
  };

  const record = (step: Step) => void send({ cmd: "record", step });

  const steps = node?.steps ?? [];
  const varNames = Object.keys(flow.start.vars);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-w-[96vw] gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
      >
        <div className="flex min-w-0 flex-1 flex-col bg-black/40">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Back"
              disabled={phase !== "live"}
              onClick={() => void send({ cmd: "back" })}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </Button>
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^https?:\/\//i.test(address))
                  void send({ cmd: "goto", url: address });
                else toast.error("Only http(s) addresses.");
              }}
            >
              <Input
                value={phase === "live" && address === "" ? url : address}
                onChange={(e) => setAddress(e.target.value)}
                onFocus={() => setAddress(url)}
                spellCheck={false}
                disabled={phase !== "live"}
                className="h-7 font-mono text-[11px]"
              />
            </form>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "act" | "pick")}
              className="h-7"
            >
              <ToggleGroupItem
                value="act"
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <HugeiconsIcon icon={Cursor01Icon} size={13} /> Act
              </ToggleGroupItem>
              <ToggleGroupItem
                value="pick"
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <HugeiconsIcon icon={Target02Icon} size={13} /> Pick only
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
            <div
              className="relative max-h-full max-w-full overflow-hidden rounded-[18px] border-4 border-zinc-800 bg-zinc-900 shadow-2xl"
              style={{
                aspectRatio: `${device.width} / ${device.height}`,
                height: "100%",
              }}
            >
              {frame ? (
                <img
                  src={frame}
                  alt="The live page"
                  draggable={false}
                  className="absolute inset-0 size-full object-fill select-none"
                />
              ) : null}
              <button
                type="button"
                aria-label="The page: click to act, scroll to scroll"
                className={cn(
                  "absolute inset-0 size-full",
                  phase === "live"
                    ? mode === "act"
                      ? "cursor-pointer"
                      : "cursor-crosshair"
                    : "cursor-wait",
                )}
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
                onClick={onClick}
                onWheel={onWheel}
              />
              {hover ? <Highlight found={hover} tone="hover" /> : null}
              {picked ? <Highlight found={picked} tone="picked" /> : null}
              {phase !== "live" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-xs text-white">
                  {phase === "closed" ? (
                    "The live page is closed."
                  ) : (
                    <>
                      <Spinner />
                      {phase === "starting"
                        ? "Opening the browser…"
                        : `Replaying the journey · step ${Math.min(progress.index + 1, progress.total)}/${progress.total}`}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="flex w-[340px] shrink-0 flex-col border-l">
          <div className="flex items-start gap-2 border-b p-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm">
                Record on the site · {node?.caption || nodeId}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {mode === "act"
                  ? "Click on the page as a visitor would: each action is played and added to this node."
                  : "Click an element to choose what to do with it, without clicking it."}
              </DialogDescription>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Close"
              onClick={close}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </Button>
          </div>

          {mode === "pick" && picked ? (
            <div className="flex flex-col gap-1.5 border-b p-4">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Picked:{" "}
                {stepLabel({
                  do: "tap",
                  target: picked.target as Target,
                }).replace(/^Tap /, "")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    record({ do: "tap", target: picked.target as Target })
                  }
                >
                  Tap it
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    record({ do: "waitFor", target: picked.target as Target })
                  }
                >
                  Wait for it
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    record({ do: "scroll", to: picked.target as Target })
                  }
                >
                  Scroll to it
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    record({
                      do: "remember",
                      name: rememberAs.replace(/\W/g, "") || "value",
                      target: picked.target as Target,
                    })
                  }
                >
                  Remember its text as
                </Button>
                <Input
                  value={rememberAs}
                  onChange={(e) => setRememberAs(e.target.value)}
                  aria-label="Name of the remembered value"
                  className="h-8 w-24 font-mono text-xs"
                />
                {picked.checkable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      record({
                        do: "check",
                        target: picked.target as Target,
                        value: true,
                      })
                    }
                  >
                    Check it
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-b p-4">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {field
                ? `Type into ${stepLabel({ do: "type", target: field, text: "" }).replace(/^Type into /, "")}`
                : "Type on the keyboard"}
            </span>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                typeText();
              }}
            >
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Text, or a {{value}}"
                disabled={phase !== "live"}
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                type="submit"
                disabled={phase !== "live" || !text}
              >
                Type
              </Button>
            </form>
            {varNames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {varNames.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setText((t) => `${t}{{${n}}}`)}
                    className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] hover:bg-white/20"
                  >
                    {`{{${n}}}`}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={phase !== "live"}
                onClick={() => void send({ cmd: "type", text: "{{code}}" })}
              >
                Type the received code
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={phase !== "live"}
                onClick={() => void send({ cmd: "press", key: "Enter" })}
              >
                Press Enter
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={phase !== "live"}
                onClick={() => record({ do: "wait", ms: 1000 })}
              >
                Wait 1 s
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={phase !== "live"}
                onClick={() =>
                  record({
                    do: "waitUrl",
                    match: new URL(url).pathname.replace(
                      /[.*+?^${}()|[\]\\]/g,
                      "\\$&",
                    ),
                  })
                }
              >
                Wait for this address
              </Button>
              {field ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setField(null)}
                >
                  Unselect field
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Steps of this node ({steps.length})
            </span>
            {notes.map((n) => (
              <p key={n} className="text-[11px] text-amber-300">
                {n}
              </p>
            ))}
            {steps.map((s, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: order is the identity of a step
                key={i}
                className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
              >
                <span className="w-5 text-[10px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{stepLabel(s)}</span>
                <button
                  type="button"
                  aria-label="Remove this step"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    flowActions.setSteps(
                      nodeId,
                      steps.filter((_, k) => k !== i),
                    )
                  }
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t p-3">
            <Button className="w-full" onClick={close}>
              Done
            </Button>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}

function Highlight({
  found,
  tone,
}: {
  found: NonNullable<Found>;
  tone: "hover" | "picked";
}) {
  const label = stepLabel({
    do: "tap",
    target: found.target as Target,
  }).replace(/^Tap /, "");
  return (
    <div
      className={cn(
        "pointer-events-none absolute rounded-sm border-2",
        tone === "hover"
          ? "border-sky-400 bg-sky-400/10"
          : "border-amber-400 bg-amber-400/15",
      )}
      style={{
        left: `${found.box.u * 100}%`,
        top: `${found.box.v * 100}%`,
        width: `${found.box.w * 100}%`,
        height: `${found.box.h * 100}%`,
      }}
    >
      {tone === "hover" ? (
        <span className="absolute -top-5 left-0 max-w-[260px] truncate rounded bg-sky-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white">
          {label}
        </span>
      ) : null}
    </div>
  );
}
