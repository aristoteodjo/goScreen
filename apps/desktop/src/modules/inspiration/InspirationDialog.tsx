import { blockById } from "@goscreen/blocks";
import type { KitElement } from "@goscreen/inspiration";
import {
  briefOf,
  CATEGORIES,
  type Category,
  GENRES,
  type Genre,
  GOSCREEN_TOOLS,
  type Inspiration,
  LIBRARY_HOME,
  search,
} from "@goscreen/inspiration";
import { useMutation } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Live } from "@/modules/editor/BlocksDialog";
import { useSession } from "@/modules/editor/session";
import { useEdit } from "@/modules/editor/store";
import { kitForEdit, placeKit } from "./kit";
import {
  useInspirations,
  useSyncInspirations,
  withInspiration,
} from "./library";

// The inspiration library: shared prompts read as creative directions. Pick
// one to set the film in its format, colours and type, or copy its brief
// (credit, direction, how to do each technique here) for an AI.

type DialogState = {
  open: boolean;
  // Opened from a proposal: its genres are preselected.
  genres: Genre[];
  show: (o?: { genres?: Genre[] }) => void;
  close: () => void;
};

export const useInspirationDialog = create<DialogState>((set) => ({
  open: false,
  genres: [],
  show: (o) => set({ open: true, genres: o?.genres ?? [] }),
  close: () => set({ open: false }),
}));

export function InspirationDialog() {
  const { open, close, genres: preset } = useInspirationDialog();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Inspiration</DialogTitle>
          <DialogDescription>
            Videos made as code, each with the prompt its creator shared. Use
            one as the film's direction; the creator stays credited.
          </DialogDescription>
        </DialogHeader>
        {open ? <Library key={preset.join(",")} preset={preset} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Library({ preset }: { preset: Genre[] }) {
  const { data: all = [], isLoading } = useInspirations();
  const sync = useSyncInspirations();
  const [text, setText] = useState("");
  const [genres, setGenres] = useState<Genre[]>(preset);
  const [category, setCategory] = useState<Category | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const results = useMemo(
    () =>
      search(all, {
        text,
        genres,
        category: category ?? undefined,
        limit: 60,
      }),
    [all, text, genres, category],
  );
  const current = results.find((i) => i.slug === picked) ?? results[0];

  if (isLoading)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  if (all.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <p className="max-w-md">
          The library is downloaded once from the community list (MIT) and kept
          on this Mac. Nothing else leaves the machine.
        </p>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Spinner /> : null}
          Download the library
        </Button>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => void openUrl(LIBRARY_HOME)}
        >
          {LIBRARY_HOME.replace("https://", "")}
        </button>
      </div>
    );

  const toggle = (g: Genre) =>
    setGenres((gs) =>
      gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g],
    );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search: launch, cursor, counter, spotify…"
            className="h-8 text-[13px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            title="Download the latest list"
          >
            {sync.isPending ? <Spinner /> : "Update"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              on={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </Chip>
          ))}
          <span className="mx-1 w-px bg-border" />
          {GENRES.map((g) => (
            <Chip key={g} on={genres.includes(g)} onClick={() => toggle(g)}>
              {g}
            </Chip>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {results.length === 60 ? "60+" : results.length} of {all.length}
        </p>
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-2">
          {results.map((i) => (
            <button
              key={i.slug}
              type="button"
              onClick={() => setPicked(i.slug)}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-2 text-left transition-colors hover:border-violet-400/60",
                current?.slug === i.slug &&
                  "border-violet-400 bg-violet-400/10",
              )}
            >
              <span className="flex items-center gap-2 text-[12px] font-medium">
                @{i.author}
                <span className="text-[11px] font-normal text-muted-foreground">
                  {[
                    i.category,
                    i.direction.aspect,
                    i.direction.duration && `${i.direction.duration} s`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <Swatches inspiration={i} className="ml-auto" />
              </span>
              <span className="line-clamp-2 text-[11px] text-muted-foreground">
                {i.prompt}
              </span>
            </button>
          ))}
        </div>
      </div>
      {current ? <Detail inspiration={current} /> : null}
    </div>
  );
}

function Detail({ inspiration: i }: { inspiration: Inspiration }) {
  const edit = useEdit((s) => s.edit);
  const change = useEdit((s) => s.change);
  const close = useInspirationDialog((s) => s.close);
  const d = i.direction;
  const following = edit.film?.settings
    ? (edit.film.settings as { inspiration?: string }).inspiration === i.slug
    : false;
  const apply = () => {
    change((ed) => withInspiration(ed, i), "film-inspiration");
    toast.success(`The film follows @${i.author}'s direction (⌘Z to undo).`);
    close();
  };
  const copy = async () => {
    await navigator.clipboard.writeText(briefOf(i));
    toast.success("Brief copied: paste it to your AI.");
  };
  const facts = [
    d.aspect && `${d.aspect}`,
    d.size && `${d.size.width}×${d.size.height}`,
    d.duration && `${d.duration} s`,
    d.fps && `${d.fps} fps`,
    d.bpm && `${d.bpm} BPM`,
    ...d.fonts,
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-medium">@{i.author}</span>
        {i.post_url ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => void openUrl(i.post_url)}
          >
            Original post
          </button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            Copy brief
          </Button>
          <Button size="sm" onClick={apply} disabled={following}>
            {following ? "Following" : "Use as direction"}
          </Button>
        </div>
      </div>
      {i.prompt_partial ? (
        <p className="text-[11px] text-amber-400">
          Only part of the prompt was shared: a description of the result.
        </p>
      ) : null}
      {facts.length || d.palette.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {facts.map((f) => (
            <Chip key={String(f)} on={false}>
              {f}
            </Chip>
          ))}
          <Swatches inspiration={i} big />
        </div>
      ) : null}
      <KitSection key={i.slug} inspiration={i} />
      {d.techniques.length ? (
        <Block title="Techniques">
          <ul className="flex flex-col gap-0.5">
            {d.techniques.map((t) => (
              <li key={t} className="text-[11px]">
                <span className="font-medium">{t}</span>
                <span className="text-muted-foreground">
                  {" — "}
                  {GOSCREEN_TOOLS[t] ?? "not available in goScreen yet"}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {d.structure.length ? (
        <Block title="Structure">
          <ol className="list-decimal pl-4 text-[11px]">
            {d.structure.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Block>
      ) : null}
      {d.banned.length ? (
        <Block title="Banned">
          <p className="text-[11px]">{d.banned.join(" · ")}</p>
        </Block>
      ) : null}
      <Block title="Prompt">
        <pre className="whitespace-pre-wrap font-sans text-[11px] text-muted-foreground">
          {i.prompt}
        </pre>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const cls = cn(
    "rounded-full border px-2 py-0.5 text-[11px]",
    on ? "border-violet-400 bg-violet-400/15" : "text-muted-foreground",
  );
  return onClick ? (
    <button
      type="button"
      className={cn(cls, "hover:border-violet-400/60")}
      onClick={onClick}
    >
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

function Swatches({
  inspiration,
  big,
  className,
}: {
  inspiration: Inspiration;
  big?: boolean;
  className?: string;
}) {
  const palette = inspiration.direction.palette.slice(0, 6);
  if (!palette.length) return null;
  return (
    <span className={cn("flex", className)}>
      {palette.map((s) => (
        <span
          key={s.hex}
          title={s.role ? `${s.hex} · ${s.role}` : s.hex}
          className={cn(
            "-ml-1 rounded-full border border-black/30 first:ml-0",
            big ? "size-5" : "size-3",
          )}
          style={{ background: s.hex }}
        />
      ))}
    </span>
  );
}

/** The inspiration's graphic elements, live, ready to lay along the film. */
function KitSection({ inspiration: i }: { inspiration: Inspiration }) {
  const edit = useEdit((s) => s.edit);
  const videoPath = useSession((s) => s.videoPath);
  const kit = useMemo(() => kitForEdit(edit, i), [edit, i]);
  // Each block appears once in a kit: its id names the element.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const picked = kit.filter((k) => !off.has(k.block));
  const add = useMutation({
    mutationFn: async (elements: KitElement[]) => {
      const before = useEdit.getState().edit;
      return placeKit(videoPath, before, elements, (done, total) =>
        setProgress(done < total ? `Rendering ${done + 1} of ${total}…` : null),
      );
    },
    onSuccess: (result) => {
      setProgress(null);
      if (!result || !Array.isArray(result.overlays) || !result.edit) return;
      useEdit.getState().change(() => result.edit, "inspiration-kit");
      toast.success(
        `${result.overlays.length} elements from @${i.author} added along the film (⌘Z to undo).`,
      );
    },
    onError: (e) => {
      setProgress(null);
      toast.error(e instanceof Error ? e.message : String(e));
    },
  });
  if (kit.length === 0)
    return (
      <Block title="Elements">
        <p className="text-[11px] text-muted-foreground">
          This prompt gives no copy or numbers to lay out. Its direction and
          brief still apply.
        </p>
      </Block>
    );
  const toggle = (id: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Block title="Elements">
      <p className="text-[11px] text-muted-foreground">
        Graphic elements this prompt shows, with its words and numbers, in the
        film's colours. Each becomes a block layer you can move and edit.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {kit.map((k) => {
          const block = blockById(k.block);
          if (!block) return null;
          return (
            <div
              key={k.block}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                off.has(k.block) ? "opacity-50" : "border-violet-400/60",
              )}
            >
              <span className="flex items-center gap-2 text-[11px] font-medium">
                <Checkbox
                  id={`kit-${k.block}`}
                  checked={!off.has(k.block)}
                  onCheckedChange={() => toggle(k.block)}
                />
                <label htmlFor={`kit-${k.block}`} className="cursor-pointer">
                  {block.label}
                </label>
                <span className="ml-auto font-normal text-muted-foreground">
                  {k.place === "open"
                    ? "opening"
                    : k.place === "close"
                      ? "ending"
                      : "scenes"}
                </span>
              </span>
              <Live block={block} props={k.props} width={220} />
              <span className="text-[10px] text-muted-foreground">
                {k.reason}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => add.mutate(picked)}
          disabled={add.isPending || picked.length === 0 || !videoPath}
        >
          {add.isPending ? <Spinner /> : null}
          Add {picked.length} element{picked.length === 1 ? "" : "s"} to the
          film
        </Button>
        {progress ? (
          <span className="text-[11px] text-muted-foreground">{progress}</span>
        ) : null}
      </div>
    </Block>
  );
}
