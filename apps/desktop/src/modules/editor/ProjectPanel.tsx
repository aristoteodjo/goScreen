import { BLOCKS } from "@goscreen/blocks";
import {
  ANIMATION_PRESETS,
  applyPreset,
  clipDuration,
  formatTime,
  placeClips,
  type Transition,
} from "@goscreen/render-engine";
import {
  Add01Icon,
  AudioWave01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type DragEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { editActions, TEXT_PRESETS } from "./actions";
import { BlockThumb, useBlocksDialog } from "./BlocksDialog";
import { CompositionThumb, useCompositionsDialog } from "./CompositionsDialog";
import { useCompositions } from "./compositions";
import { PanelFrame } from "./PanelFrame";
import { player, useSession } from "./session";
import { useEdit, usePlayback } from "./store";
import { SHAPES } from "./TimelineToolbar";
import { VoiceOverButton, VoiceOverMicMenu } from "./voiceover";
import { type LeftTab, useWorkspace } from "./workspace";

// The Project panel, Premiere style: the film's media in a bin (drag them
// onto the timeline), the blocks, the effects and the scenes.

export const ASSET_DRAG = "application/x-goscreen-asset";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "blocks", label: "Blocks" },
  { id: "compositions", label: "Compositions" },
  { id: "effects", label: "Effects" },
  { id: "scenes", label: "Scenes" },
];

export function ProjectPanel() {
  const left = useWorkspace((s) => s.left);
  return (
    <PanelFrame
      ai="project"
      tabs={TABS}
      active={left}
      onTab={(t) => useWorkspace.getState().setLeft(t)}
      bodyClassName="flex flex-col"
    >
      {left === "project" ? <MediaBin /> : null}
      {left === "blocks" ? <BlocksBin /> : null}
      {left === "compositions" ? <CompositionsBin /> : null}
      {left === "effects" ? <EffectsBin /> : null}
      {left === "scenes" ? <ScenesBin /> : null}
    </PanelFrame>
  );
}

function MediaBin() {
  const name = useSession((s) => s.name);
  const videoUrl = useSession((s) => s.videoUrl);
  const assetUrls = useSession((s) => s.assetUrls);
  const duration = usePlayback((s) => s.duration);
  const assets = useEdit((s) => s.edit.assets);
  const [query, setQuery] = useState("");
  const shown = assets.filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const count = assets.length + 1;

  return (
    <>
      <div className="flex items-center justify-between px-3 pt-1 text-[11.5px] text-muted-foreground">
        <span className="truncate">{name}</span>
        <span className="shrink-0">
          {count} item{count > 1 ? "s" : ""}
        </span>
      </div>
      <div className="relative px-3 py-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="h-7 rounded-full pl-7 text-xs"
        />
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2 gap-y-3 overflow-y-auto px-3 pb-3">
        {query === "" ? (
          <Tile
            name={name}
            meta={formatTime(duration)}
            tone="bg-sky-600"
            title="The recording: the V1 track"
            onActivate={() => player.first()}
          >
            {videoUrl ? (
              <video
                src={`${videoUrl}#t=1`}
                muted
                preload="metadata"
                crossOrigin="anonymous"
                className="size-full object-cover"
              />
            ) : null}
          </Tile>
        ) : null}
        {shown.map((a) => {
          const url = assetUrls[a.file];
          return (
            <Tile
              key={a.id}
              name={a.name}
              meta={a.duration ? formatTime(a.duration) : "Still"}
              tone={a.kind === "audio" ? "bg-emerald-600" : "bg-violet-500"}
              title="Double-click or drag onto the timeline"
              drag={a.id}
              onActivate={() => void editActions.placeAsset(a.id)}
            >
              {a.kind === "image" && url ? (
                <img src={url} alt="" className="size-full object-cover" />
              ) : a.kind === "video" && url ? (
                <video
                  src={`${url}#t=0.5`}
                  muted
                  preload="metadata"
                  className="size-full object-cover"
                />
              ) : (
                <HugeiconsIcon
                  icon={AudioWave01Icon}
                  size={26}
                  className="text-emerald-300"
                />
              )}
            </Tile>
          );
        })}
      </div>
      <footer className="flex h-9 shrink-0 items-center gap-1 border-t border-white/5 px-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-[12px]"
          onClick={() =>
            void editActions.importMedia(["image", "video", "audio"], {
              place: false,
            })
          }
        >
          <HugeiconsIcon icon={Folder01Icon} size={14} />
          Import…
        </Button>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <VoiceOverMicMenu />
          <VoiceOverButton className="size-7" />
        </div>
      </footer>
    </>
  );
}

function Tile({
  name,
  meta,
  tone,
  title,
  drag,
  onActivate,
  children,
}: {
  name: string;
  meta: string;
  tone: string;
  title: string;
  drag?: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  const onDragStart = (e: DragEvent) => {
    if (!drag) return;
    e.dataTransfer.setData(ASSET_DRAG, drag);
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <button
      type="button"
      title={title}
      draggable={drag !== undefined}
      onDragStart={onDragStart}
      onDoubleClick={onActivate}
      className="group flex min-w-0 flex-col gap-1 text-left"
    >
      <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black/40 ring-1 ring-white/5 group-hover:ring-white/25 group-focus-visible:ring-sky-400">
        {children}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
        <span className={cn("h-2.5 w-1 shrink-0 rounded-sm", tone)} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {meta}
        </span>
      </div>
    </button>
  );
}

function BlocksBin() {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto p-3">
      {BLOCKS.map((b) => (
        <button
          key={b.id}
          type="button"
          title={b.description}
          onClick={() => useBlocksDialog.getState().show({ block: b.id })}
          className="flex min-w-0 flex-col gap-1.5 rounded-md p-1.5 text-left hover:bg-white/5"
        >
          <BlockThumb block={b} width={140} />
          <span className="truncate text-[11.5px] font-medium">{b.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Compositions of this video and of its project library, playing live. */
function CompositionsBin() {
  const videoPath = useSession((s) => s.videoPath);
  const list = useCompositions(videoPath);
  const all = [
    ...(list.data?.video ?? []).map((c) => ({ c, from: "video" })),
    ...(list.data?.library ?? []).map((c) => ({ c, from: "library" })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-muted-foreground">
        <span>{all.length === 0 ? "No composition yet" : "Click to add"}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => useCompositionsDialog.getState().show()}
        >
          Open gallery…
        </Button>
      </div>
      <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-3">
        {all.map(({ c, from }) => (
          <button
            key={`${from}-${c.id}`}
            type="button"
            title={c.description ?? c.label}
            onClick={() => useCompositionsDialog.getState().show({ pick: c })}
            className="flex min-w-0 flex-col gap-1.5 rounded-md p-1.5 text-left hover:bg-white/5"
          >
            <CompositionThumb composition={c} width={140} />
            <span className="truncate text-[11.5px] font-medium">
              {c.label}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
              {from === "library" ? "Project library" : "This video"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const TRANSITIONS: { kind: NonNullable<Transition>["kind"]; label: string }[] =
  [
    { kind: "fade", label: "Cross dissolve" },
    { kind: "dip", label: "Dip to colour" },
    { kind: "slide-left", label: "Push left" },
    { kind: "slide-up", label: "Push up" },
    { kind: "zoom", label: "Zoom through" },
    { kind: "wipe", label: "Wipe" },
    { kind: "blur", label: "Cut blur" },
    { kind: "push", label: "Push in" },
  ];

function EffectsBin() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(q);

  const applyAnimation = (id: string) => {
    const sel = usePlayback.getState().selection;
    const edit = useEdit.getState().edit;
    const o =
      sel?.kind === "overlay"
        ? edit.overlays.find((x) => x.id === sel.id)
        : undefined;
    if (!o) {
      toast.info("Select a layer on the timeline first.");
      return;
    }
    const preset = ANIMATION_PRESETS.find((p) => p.id === id);
    if (preset?.group === "text" && o.kind !== "text") {
      toast.info("This animation is for text layers.");
      return;
    }
    useEdit.getState().change(
      (ed) => ({
        ...ed,
        overlays: ed.overlays.map((x) =>
          x.id === o.id ? applyPreset(x, id) : x,
        ),
      }),
      "preset",
    );
  };

  const applyTransition = (kind: NonNullable<Transition>["kind"]) => {
    const sel = usePlayback.getState().selection;
    const edit = useEdit.getState().edit;
    const t = usePlayback.getState().time;
    const placed = placeClips(edit.clips);
    // The selected clip, else the cut nearest the playhead.
    const target =
      sel?.kind === "clip"
        ? placed.find((p) => p.clip.id === sel.id)
        : placed
            .slice(1)
            .reduce<(typeof placed)[number] | undefined>(
              (best, p) =>
                !best || Math.abs(p.start - t) < Math.abs(best.start - t)
                  ? p
                  : best,
              undefined,
            );
    if (!target || target === placed[0]) {
      toast.info("Select the clip after a cut first.");
      return;
    }
    editActions.setTransition(target.clip.id, { kind, duration: 0.5 });
    toast.success(`Transition on ${formatTime(target.start)}`);
  };

  const groups = [
    {
      title: "Text animations",
      items: ANIMATION_PRESETS.filter(
        (p) => p.group === "text" && match(p.label),
      ).map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.description,
        run: () => applyAnimation(p.id),
      })),
    },
    {
      title: "Motion",
      items: ANIMATION_PRESETS.filter(
        (p) => p.group === "motion" && match(p.label),
      ).map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.description,
        run: () => applyAnimation(p.id),
      })),
    },
    {
      title: "Video transitions",
      items: TRANSITIONS.filter((x) => match(x.label)).map((x) => ({
        id: x.kind,
        label: x.label,
        hint: "On the selected clip, or the cut nearest the playhead",
        run: () => applyTransition(x.kind),
      })),
    },
    {
      title: "Titles",
      items: TEXT_PRESETS.filter((x) => match(x.label)).map((x) => ({
        id: x.id,
        label: x.label,
        hint: "A new text layer at the playhead",
        run: () => editActions.addText(x),
      })),
    },
    {
      title: "Shapes",
      items: SHAPES.filter((x) => match(x.label)).map((x) => ({
        id: x.id,
        label: x.label,
        hint: "A new shape layer at the playhead",
        run: () => editActions.addShape(x.id),
      })),
    },
    {
      title: "Privacy",
      items: [
        {
          id: "blur",
          label: "Blur",
          hint: "Hides what is under it",
          run: () => editActions.addBlur("blur"),
        },
        {
          id: "pixelate",
          label: "Pixelate",
          hint: "Hides what is under it",
          run: () => editActions.addBlur("pixelate"),
        },
      ].filter((x) => match(x.label)),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <div className="relative px-3 py-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search effects"
          className="h-7 rounded-full pl-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((g) => (
          <details key={g.title} open className="group/fx mb-1">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 text-[12px] text-muted-foreground hover:text-foreground">
              <HugeiconsIcon icon={Folder01Icon} size={13} />
              {g.title}
            </summary>
            <ul className="ml-4">
              {g.items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    title={i.hint}
                    onDoubleClick={i.run}
                    onClick={(e) => e.detail === 0 && i.run()}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={12}
                      className="text-muted-foreground opacity-0 group-hover/fx:opacity-60"
                      onClick={(e) => {
                        e.stopPropagation();
                        i.run();
                      }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <footer className="flex h-8 shrink-0 items-center border-t border-white/5 px-3 text-[11px] text-muted-foreground">
        Double-click an effect to apply it.
      </footer>
    </>
  );
}

function ScenesBin() {
  const clips = useEdit((s) => s.edit.clips);
  const chapters = useSession((s) => s.chapters);
  const selection = usePlayback((s) => s.selection);
  const placed = useMemo(() => placeClips(clips), [clips]);
  return (
    <ol className="min-h-0 flex-1 overflow-y-auto p-2">
      {placed.map((p, i) => {
        const c = p.clip;
        const label =
          c.kind === "slide"
            ? c.title || "Card"
            : (chapters.find(
                (ch) => ch.caption && c.in >= ch.start - 0.05 && c.in < ch.end,
              )?.caption ?? `Clip ${i + 1}`);
        const active = selection?.kind === "clip" && selection.id === c.id;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => {
                player.seek(p.start);
                usePlayback.getState().select({ kind: "clip", id: c.id });
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/5",
                active && "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "h-3 w-1 shrink-0 rounded-sm",
                  c.kind === "slide" ? "bg-indigo-400" : "bg-sky-500",
                )}
              />
              <span className="w-12 shrink-0 font-mono text-[11px] text-sky-300 tabular-nums">
                {formatTime(p.start)}
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {clipDuration(c).toFixed(1)}s
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
