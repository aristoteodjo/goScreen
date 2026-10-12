import {
  FIDELITY_PASS,
  type MotionSpec,
  reviewsAgree,
  type Shot,
  type ShotMeasure,
  ShotReview,
  shotKeyTime,
} from "@goscreen/motion";
import {
  ArrowLeft01Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/modules/projects/dialogs";
import { useTabTitle } from "@/modules/tabs/tabs";
import { register, seek, stopped, togglePlay, useCompare } from "./compare";
import { linesToText, reviewOfShot, textToLines } from "./correction";
import {
  describeJob,
  renderingsOf,
  useFrame,
  useLocalAi,
  useMotionProgress,
  useProgressEvents,
  useReference,
  useReport,
  useSpec,
  useStudentAnswer,
  useVideoUrl,
} from "./hooks";
import { motionIpc, type Reference } from "./ipc";
import { LocalModelBadge, LocalModelDialog } from "./LocalModelDialog";
import {
  analyzeReference,
  deriveSpec,
  type RenderReport,
  renderAndMeasure,
  reviewAll,
  reviewShot,
  saveSpec,
  teachShot,
} from "./pipeline";
import { refreshMotion } from "./store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const pct = (n: number) => `${Math.round(n * 100)} %`;

type ShotScore = ShotMeasure & { fidelity: number };

/** Green when it passes, amber when close, red when far; grey unmeasured. */
const fidelityTone = (f: number | undefined) =>
  f === undefined
    ? "bg-white/15"
    : f >= FIDELITY_PASS
      ? "bg-emerald-500"
      : f >= 0.6
        ? "bg-amber-500"
        : "bg-red-500";

/** "L'IA qui vend" for a text shot, its label for the others. */
const shotTitle = (s: Shot) =>
  s.kind === "text"
    ? s.lines.map((l) => l.words.map((w) => w.text).join(" ")).join(" / ")
    : s.label || "Not rebuilt yet";

// One reference: the original and a rendering side by side on one clock,
// the shots on a strip coloured by fidelity, and for the selected shot what
// the spec, the local model and the measures say, with a correction that
// rewrites the spec and teaches the local model.
export function ReproducePage({ id }: { id: string }) {
  useProgressEvents();
  const navigate = useNavigate();
  const reference = useReference(id);
  const ref = reference.data;
  useTabTitle(ref?.name);
  const files = ref?.files ?? [];
  const hasSpec = files.includes("spec.json");
  const spec = useSpec(id, hasSpec);
  const renders = renderingsOf(files);
  const [chosenRender, setRender] = useState<string | null>(null);
  const render = chosenRender && renders.includes(chosenRender) ? chosenRender : (renders[0] ?? null);
  const report = useReport(id, render);
  const [selected, setSelected] = useState<string | null>(null);
  const [model, setModel] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [reviewing, setReviewing] = useState<{ done: number; total: number } | null>(null);
  const job = useMotionProgress((s) => s.job);
  const ai = useLocalAi();
  const aiRunning = !!ai.data?.running;

  const analyse = useMutation({
    mutationFn: async () => {
      await analyzeReference(id);
      return deriveSpec(id);
    },
    onSuccess: (s) => {
      if (Array.isArray(s?.shots)) toast.success(`${s.shots.length} shots found`);
    },
    onError: (e) => toast.error(message(e)),
    onSettled: refreshMotion,
  });
  const readAll = useMutation({
    mutationFn: () => reviewAll(id, (done, total) => setReviewing({ done, total })),
    onSuccess: (s) => {
      if (Array.isArray(s?.shots)) toast.success(`The local model read ${s.shots.length} shots`);
    },
    onError: (e) => toast.error(message(e)),
    onSettled: () => {
      setReviewing(null);
      refreshMotion();
    },
  });
  const renderIt = useMutation({
    mutationFn: () => renderAndMeasure(id),
    onSuccess: (r) => {
      if (typeof r?.render !== "string") return;
      setRender(r.render);
      toast.success(`Rendered: ${pct(r.score)} faithful`);
    },
    onError: (e) => toast.error(message(e)),
    onSettled: refreshMotion,
  });
  const busy = analyse.isPending || readAll.isPending || renderIt.isPending;
  const progress = reviewing
    ? `Local model ${reviewing.done + 1}/${reviewing.total}`
    : (describeJob(job) ?? (busy ? "Working…" : null));

  const shots = spec.data?.shots ?? [];
  const scores = new Map((report.data?.shots ?? []).map((m) => [m.id, m]));
  const current = shots.find((s) => s.id === selected) ?? shots[0] ?? null;

  if (reference.isPending) return <Skeleton className="m-6 h-64" />;
  if (!ref)
    return (
      <div className="flex flex-col items-start gap-3 p-6 text-sm">
        <p>This reference no longer exists.</p>
        <Button size="sm" variant="outline" onClick={() => navigate({ to: "/reproduce", search: {} })}>
          Back to the references
        </Button>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button size="icon-sm" variant="ghost" aria-label="References" onClick={() => navigate({ to: "/reproduce", search: {} })}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
        </Button>
        <span className="truncate text-[13px] font-semibold">{ref.name}</span>
        {report.data ? (
          <span className="text-[13px] text-muted-foreground">· {pct(report.data.score)} faithful</span>
        ) : null}
        <div data-ai="motion-steps" className="ml-auto flex items-center gap-2">
          {progress ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner />
              {progress}
            </span>
          ) : null}
          {busy && !reviewing ? (
            <Button size="sm" variant="ghost" onClick={() => void motionIpc.cancel()}>
              Stop
            </Button>
          ) : null}
          <LocalModelBadge onClick={() => setModel(true)} />
          {!hasSpec ? (
            <Button size="sm" disabled={busy} onClick={() => analyse.mutate()}>
              Measure the video
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !aiRunning || !spec.data}
                title={aiRunning ? "The local model reads every shot" : "Start the local model first"}
                onClick={() => readAll.mutate()}
              >
                Read every shot
              </Button>
              <Button size="sm" disabled={busy || !spec.data} onClick={() => renderIt.mutate()}>
                Render and compare
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="More">
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={busy} onSelect={() => analyse.mutate()}>
                    Measure again
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={busy} onSelect={() => setResetting(true)}>
                    Start the spec over…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>

      {!hasSpec ? (
        <div className="mx-auto mt-24 max-w-md text-center text-sm text-muted-foreground">
          {analyse.isPending
            ? "Measuring cuts, words, timing and colours. About a second per second of video."
            : "Measure the video to find its shots and words."}
        </div>
      ) : spec.isError ? (
        <p className="p-6 text-sm text-destructive">{message(spec.error)}</p>
      ) : !spec.data ? (
        <Skeleton className="m-6 h-64" />
      ) : (
        <>
          <Compare
            reference={ref}
            spec={spec.data}
            render={render}
            renders={renders}
            onRender={setRender}
            scores={scores}
            selected={current?.id ?? null}
            onSelect={setSelected}
          />
          <div className="flex min-h-0 flex-1 border-t">
            <ShotList shots={shots} scores={scores} selected={current?.id ?? null} onSelect={setSelected} />
            {current ? (
              <ShotDetail
                key={current.id}
                reference={ref}
                shot={current}
                index={shots.indexOf(current)}
                spec={spec.data}
                score={scores.get(current.id)}
                aiRunning={aiRunning}
                busy={busy}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">No shot was found in this video.</p>
            )}
          </div>
        </>
      )}

      <LocalModelDialog open={model} onOpenChange={setModel} />
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Start the spec over?"
        description="The spec goes back to what the measurements found; every correction made on it is lost. What the local model learnt from them is kept."
        action="Start over"
        onConfirm={async () => {
          await deriveSpec(id);
          refreshMotion();
        }}
      />
    </div>
  );
}

function Compare({
  reference,
  spec,
  render,
  renders,
  onRender,
  scores,
  selected,
  onSelect,
}: {
  reference: Reference;
  spec: MotionSpec;
  render: string | null;
  renders: string[];
  onRender: (r: string) => void;
  scores: Map<string, ShotScore>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const time = useCompare((s) => s.time);
  const playing = useCompare((s) => s.playing);
  const original = useVideoUrl(reference.id, "reference");
  const rendering = useVideoUrl(reference.id, render);
  const duration = spec.duration;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopped();
    };
  }, []);

  return (
    <section className="flex h-[46%] min-h-56 shrink-0 flex-col gap-2 p-3">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <Monitor label="Reference" url={original.data} lead aspect={spec.width / spec.height} />
        <Monitor
          label={
            renders.length ? (
              <Select value={render ?? undefined} onValueChange={(v) => v && onRender(v as string)}>
                <SelectTrigger size="sm" className="h-6 w-auto gap-1 border-0 bg-black/50 px-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {renders.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(".mp4", "").replace("render-", "Rendering ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              "Rendering"
            )
          }
          url={rendering.data}
          aspect={spec.width / spec.height}
          empty="Render the spec to compare it with the reference."
        />
      </div>
      <div className="flex items-center gap-3">
        <Button size="icon-sm" variant="ghost" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={16} />
        </Button>
        <span className="w-24 text-xs text-muted-foreground tabular-nums">
          {clock(time)} / {clock(duration)}
        </span>
        <div className="relative h-8 flex-1">
          <div data-ai="motion-strip" className="absolute inset-0 overflow-hidden rounded-md bg-white/5">
            {spec.shots.map((s) => (
              <button
                key={s.id}
                type="button"
                title={`${shotTitle(s)}${scores.get(s.id) ? ` · ${pct(scores.get(s.id)?.fidelity ?? 0)}` : ""}`}
                onClick={() => {
                  onSelect(s.id);
                  seek(shotKeyTime(s));
                }}
                className={cn(
                  "absolute inset-y-1 rounded-sm opacity-70 transition hover:opacity-100",
                  fidelityTone(scores.get(s.id)?.fidelity),
                  s.id === selected && "opacity-100 ring-2 ring-white",
                )}
                style={{
                  left: `calc(${(s.start / duration) * 100}% + 1px)`,
                  width: `calc(${((s.end - s.start) / duration) * 100}% - 2px)`,
                }}
              />
            ))}
          </div>
          <input
            type="range"
            aria-label="Time"
            min={0}
            max={duration}
            step={1 / 30}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            className="pointer-events-none absolute inset-x-0 -bottom-2 h-2 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white"
            style={{ left: `${(time / duration) * 100}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function Monitor({
  label,
  url,
  lead = false,
  aspect,
  empty,
}: {
  label: ReactNode;
  url: string | undefined;
  lead?: boolean;
  aspect: number;
  empty?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // What the element says about its source: shown, since a monitor that
  // stays black explains nothing.
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  useEffect(() => {
    setState("loading");
    if (!video.current || !url) return;
    return register(video.current, lead);
  }, [url, lead]);
  const codes: Record<number, string> = { 2: "network error", 3: "cannot decode", 4: "format not supported" };
  return (
    <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-black">
      {url ? (
        <video
          ref={video}
          src={url}
          muted={!lead}
          playsInline
          preload="auto"
          onLoadedData={() => setState("ready")}
          onError={(e) => {
            const code = e.currentTarget.error?.code ?? 0;
            setState(`Could not play this video (${codes[code] ?? "unknown error"}).`);
          }}
          onEnded={lead ? stopped : undefined}
          className="max-h-full max-w-full"
          style={{ aspectRatio: aspect }}
        />
      ) : null}
      {!url && empty ? <p className="px-6 text-center text-xs text-muted-foreground">{empty}</p> : null}
      {url && state !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {state === "loading" ? <Spinner /> : state}
        </div>
      ) : null}
      <div className="absolute top-2 left-2 rounded bg-black/50 px-2 py-0.5 text-xs">{label}</div>
    </div>
  );
}

function ShotList({
  shots,
  scores,
  selected,
  onSelect,
}: {
  shots: Shot[];
  scores: Map<string, ShotScore>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ol data-ai="motion-shots" className="w-72 shrink-0 overflow-y-auto border-r p-2">
      {shots.map((s, i) => {
        const f = scores.get(s.id)?.fidelity;
        return (
          <li key={s.id}>
            <button
              type="button"
              data-ai-item={s.id}
              onClick={() => {
                onSelect(s.id);
                seek(shotKeyTime(s));
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5",
                s.id === selected && "bg-white/10",
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", fidelityTone(f))} />
              <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className={cn("min-w-0 flex-1 truncate", s.kind !== "text" && "text-muted-foreground italic")}>
                {shotTitle(s)}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {f === undefined ? `${(s.end - s.start).toFixed(1)} s` : pct(f)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ShotDetail({
  reference,
  shot,
  index,
  spec,
  score,
  aiRunning,
  busy,
}: {
  reference: Reference;
  shot: Shot;
  index: number;
  spec: MotionSpec;
  score: ShotScore | undefined;
  aiRunning: boolean;
  busy: boolean;
}) {
  const id = reference.id;
  const frame = useFrame(id, "reference", shotKeyTime(shot), 640);
  const student = useStudentAnswer(id, shot.id, reference.files);
  const [draft, setDraft] = useState(() => draftOf(reviewOfShot(shot)));

  const teach = useMutation({
    mutationFn: (answer: ShotReview) => teachShot(id, shot.id, answer, "person"),
    onSuccess: (r, answer) => {
      if (typeof r?.example !== "string") return;
      toast.success(
        r.student === null
          ? "Saved. The local model will learn from it."
          : reviewsAgree(r.student, answer)
            ? "Saved. The local model had already read it right."
            : "Saved. The local model had read it differently: it learns from this.",
      );
    },
    onError: (e) => toast.error(message(e)),
    onSettled: refreshMotion,
  });
  const ask = useMutation({
    mutationFn: async () => {
      const r = await reviewShot(id, spec, index);
      await saveSpec(id, r.spec);
      return r;
    },
    onSuccess: (r) => {
      if (!r?.review) return;
      setDraft(draftOf(r.review));
      toast.success(r.lessons ? `Read with ${r.lessons} examples from its teachers` : "Read (no example to learn from yet)");
    },
    onError: (e) => toast.error(message(e)),
    onSettled: refreshMotion,
  });

  const aspect = spec.width / spec.height;
  // Portrait frames side by side stay readable taller than landscape ones.
  const tileHeight = aspect < 1 ? 300 : 170;
  const answer = answerOf(draft);
  const valid = ShotReview.safeParse(answer).success && (draft.kind !== "text" || answer.lines.length > 0);

  return (
    <div className="flex min-w-0 flex-1 gap-4 overflow-y-auto p-4">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex gap-2">
          <Tile label="Reference" aspect={aspect} height={tileHeight}>
            {frame.data ? <img src={frame.data} alt="Frame of the shot" className="size-full object-contain" /> : null}
          </Tile>
          <Tile label="Spec" aspect={aspect} height={tileHeight}>
            <SpecPreview shot={shot} height={tileHeight} />
          </Tile>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          Shot {index + 1} · {clock(shot.start)} → {clock(shot.end)}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {score ? <Measures score={score} /> : null}

        {student.data ? (
          <section className="flex flex-col gap-1 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium">The local model read</h3>
              <Button size="xs" variant="ghost" onClick={() => setDraft(draftOf(student.data as ShotReview))}>
                Use it
              </Button>
            </div>
            <ReviewText review={student.data} />
          </section>
        ) : null}

        <form
          data-ai="motion-correct"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) teach.mutate(ShotReview.parse(answer));
          }}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium">Correct this shot</h3>
            <Select value={draft.kind} onValueChange={(v) => v && setDraft({ ...draft, kind: v as Draft["kind"] })}>
              <SelectTrigger size="sm" className="ml-auto w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="logo">Logo</SelectItem>
                <SelectItem value="interface">Interface</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.kind === "text" ? (
            <>
              <Textarea
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                rows={Math.max(3, draft.text.split("\n").length + 1)}
                className="font-mono text-sm"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                One line per line of the frame. <code>*word*</code> in the accent colour, <code>~word~</code> struck.
                Timing and layout stay measured.
              </p>
              <Input
                value={draft.kicker}
                onChange={(e) => setDraft({ ...draft, kicker: e.target.value })}
                placeholder="Small label above the text (none)"
                className="h-8"
              />
            </>
          ) : (
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What the shot shows, in a few words"
              className="h-8"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!aiRunning || ask.isPending || teach.isPending || busy}
              title={aiRunning ? undefined : "Start the local model first"}
              onClick={() => ask.mutate()}
            >
              {ask.isPending ? <Spinner /> : null}
              Ask the local model
            </Button>
            <Button type="submit" size="sm" disabled={!valid || teach.isPending || ask.isPending || busy}>
              {teach.isPending ? <Spinner /> : null}
              Save and teach
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Draft = { kind: ShotReview["kind"]; text: string; kicker: string; description: string };

const draftOf = (r: ShotReview): Draft => ({
  kind: r.kind,
  text: linesToText(r.lines),
  kicker: r.kicker ?? "",
  description: r.description,
});

const answerOf = (d: Draft): ShotReview => ({
  kind: d.kind,
  lines: d.kind === "text" ? textToLines(d.text) : [],
  kicker: d.kind === "text" && d.kicker.trim() ? d.kicker.trim() : null,
  description: d.description.trim(),
});

function Tile({ label, aspect, height, children }: { label: string; aspect: number; height: number; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ height, width: height * aspect }}>
        {children}
      </div>
      <figcaption className="text-[11px] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/**
 * The shot as the spec places it, at its last state: colours, position of
 * the text (left edge, last baseline), font size and line height, kicker,
 * accented and struck words. Not the animation: that is the rendering's job.
 */
function SpecPreview({ shot, height }: { shot: Shot; height: number }) {
  if (shot.kind !== "text")
    return (
      <div
        className="flex size-full items-center justify-center p-2 text-center text-xs text-white/60 italic"
        style={{ background: shot.background }}
      >
        {shot.label || "Placeholder"}
      </div>
    );
  const size = shot.size * height;
  return (
    <div className="relative size-full" style={{ background: shot.background, color: shot.ink }}>
      <div
        className="absolute flex flex-col"
        style={{
          left: `${shot.x * 100}%`,
          // The block ends at the last baseline, plus the part of the line box below it
          // (half the leading and the descent: the baseline sits about 0.8 em into the font box).
          bottom: `${(1 - shot.y) * 100}%`,
          transform: `translateY(${size * ((shot.lineHeight + 1) / 2 - 0.8)}px)`,
          fontSize: size,
          fontWeight: shot.weight,
          lineHeight: shot.lineHeight,
          whiteSpace: "nowrap",
        }}
      >
        {shot.kicker ? (
          <span className="font-mono tracking-widest uppercase opacity-70" style={{ fontSize: Math.max(7, size * 0.3) }}>
            {shot.kicker.text}
          </span>
        ) : null}
        {shot.lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id
          <div key={i}>
            {l.words.map((w, j) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: a word may repeat
                key={j}
                style={{ color: w.accent ? shot.accent : undefined }}
                className={cn(w.strike !== undefined && "line-through")}
              >
                {j ? " " : ""}
                {w.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewText({ review }: { review: ShotReview }) {
  if (review.kind !== "text")
    return (
      <p className="text-sm text-muted-foreground">
        {review.kind}: {review.description || "no description"}
      </p>
    );
  return (
    <div className="text-sm">
      {review.kicker ? <div className="font-mono text-[10px] uppercase opacity-70">{review.kicker}</div> : null}
      {review.lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id
        <div key={i}>
          {l.map((w, j) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a word may repeat
              key={j}
              className={cn(w.accent && "text-primary", w.strike && "line-through")}
            >
              {j ? " " : ""}
              {w.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** What the rendering got right in this shot, measure by measure. */
function Measures({ score: m }: { score: ShotScore }) {
  // Gaps, as the measures give them: 0 is the reference itself.
  const items: [string, string][] = [
    ["Words found", `${m.outWords}/${m.refWords} · ${pct((m.recall + m.precision) / 2)}`],
    ["Timing gap", `${(m.timing * 1000).toFixed(0)} ms`],
    ["Position gap", `${(m.position * 100).toFixed(1)} %`],
    ["Size gap", `${(m.size * 100).toFixed(0)} %`],
    ["Colour gap", `${(m.color * 100).toFixed(0)} %`],
  ];
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", fidelityTone(m.fidelity))} />
        <h3 className="text-xs font-medium">Rendering: {pct(m.fidelity)} faithful</h3>
        <span className="text-[11px] text-muted-foreground">passes at {pct(FIDELITY_PASS)}</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {items.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs tabular-nums">{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export type { RenderReport };
