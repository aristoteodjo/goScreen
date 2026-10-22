import {
  type Composition,
  compositionIssues,
  EXAMPLE_COMPOSITION,
  prepareCompositionHtml,
  resolveCompositionProps,
  SCENES,
  sceneFor,
} from "@goscreen/blocks";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  addCompositionHere,
  compositionBrand,
  saveComposition,
  updateComposition,
  useCompositions,
} from "./compositions";
import { useSession } from "./session";
import { useEdit } from "./store";

// The composition gallery: pages of the montage and of the project library,
// each playing live in its card; pick one, adjust its props or its HTML with
// a live preview, add it (or render the selected layer again).

type DialogState = {
  open: boolean;
  at: { x: number; y: number } | null;
  // Editing an existing composition layer instead of adding one.
  editing: string | null;
  // A composition chosen from the Project panel: opens on its settings.
  pick: Composition | null;
  show: (o?: {
    at?: { x: number; y: number };
    editing?: string;
    pick?: Composition;
  }) => void;
  close: () => void;
};

export const useCompositionsDialog = create<DialogState>((set) => ({
  open: false,
  at: null,
  editing: null,
  pick: null,
  show: (o) =>
    set({
      open: true,
      at: o?.at ?? null,
      editing: o?.editing ?? null,
      pick: o?.pick ?? null,
    }),
  close: () => set({ open: false, editing: null, pick: null }),
}));

/** A composition playing in a sandboxed frame (scripts allowed, nothing else), looping. */
export function LiveComposition({
  composition,
  props,
  width,
  className,
}: {
  composition: Composition;
  props: Record<string, string | number>;
  width: number;
  className?: string;
}) {
  const html = useMemo(
    () =>
      prepareCompositionHtml(composition, props, composition.box, {
        preview: true,
      }),
    [composition, props],
  );
  const [round, setRound] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setRound((r) => r + 1),
      (composition.duration + 1.2) * 1000,
    );
    return () => clearInterval(t);
  }, [composition.duration]);
  const scale = width / composition.box.width;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md",
        composition.transparent &&
          "bg-[conic-gradient(#3f3f46_25%,#52525b_0_50%,#3f3f46_0_75%,#52525b_0)] bg-[length:16px_16px]",
        className,
      )}
      style={{ width, height: composition.box.height * scale }}
    >
      <iframe
        key={`${round}-${html.length}`}
        title={composition.label}
        sandbox="allow-scripts"
        srcDoc={html}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{
          width: composition.box.width,
          height: composition.box.height,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

export function CompositionThumb({
  composition,
  width,
}: {
  composition: Composition;
  width: number;
}) {
  const edit = useEdit((s) => s.edit);
  return (
    <LiveComposition
      composition={composition}
      props={compositionBrand(edit, composition)}
      width={width}
    />
  );
}

const fresh = (): Composition => ({
  ...EXAMPLE_COMPOSITION,
  id: `composition-${Date.now().toString(36)}`,
});

export function CompositionsDialog() {
  const open = useCompositionsDialog((s) => s.open);
  const editing = useCompositionsDialog((s) => s.editing);
  const pick = useCompositionsDialog((s) => s.pick);
  const at = useCompositionsDialog((s) => s.at);
  const { close } = useCompositionsDialog.getState();
  const edit = useEdit((s) => s.edit);
  const videoPath = useSession((s) => s.videoPath);
  const list = useCompositions(videoPath);
  const editingLayer = editing
    ? edit.overlays.find((o) => o.id === editing)
    : undefined;
  const [draft, setDraft] = useState<Composition | null>(null);
  const [props, setProps] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (!open) return;
    if (
      editingLayer?.kind === "video" &&
      editingLayer.source &&
      "composition" in editingLayer.source
    ) {
      const id = editingLayer.source.composition;
      const found =
        list.data?.video.find((c) => c.id === id) ??
        list.data?.library.find((c) => c.id === id);
      if (found) {
        setDraft(found);
        setProps(editingLayer.source.props);
      }
    } else if (pick) {
      setDraft(pick);
      setProps({
        ...resolveCompositionProps(pick, {}),
        ...compositionBrand(useEdit.getState().edit, pick),
      });
    } else {
      setDraft(null);
      setProps({});
    }
  }, [open, editingLayer, pick, list.data]);

  const issues = useMemo(
    () => (draft ? compositionIssues(draft) : []),
    [draft],
  );

  const run = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      if (issues.length > 0) throw new Error(issues[0].message);
      if (editing) {
        const next = await updateComposition(
          useSession.getState().videoPath,
          useEdit.getState().edit,
          editing,
          { props, composition: draft },
        );
        useEdit.getState().change(() => next, "composition");
      } else await addCompositionHere(draft, props, at ?? undefined);
    },
    onSuccess: () => {
      close();
      toast.success(
        editing
          ? "Composition rendered again"
          : "Composition added at the playhead",
      );
    },
    onError: (e) =>
      toast.error("The composition could not be rendered", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  const toLibrary = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      if (issues.length > 0) throw new Error(issues[0].message);
      await saveComposition(useSession.getState().videoPath, draft, true);
    },
    onSuccess: () => toast.success("Saved to the project library"),
    onError: (e) =>
      toast.error("Could not save to the library", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  const set = (patch: Partial<Composition>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const card = (c: Composition, from: string) => (
    <button
      key={`${from}-${c.id}`}
      type="button"
      onClick={() => {
        setDraft(c);
        setProps({
          ...resolveCompositionProps(c, {}),
          ...compositionBrand(edit, c),
        });
      }}
      className="flex flex-col gap-2 rounded-lg border p-2 text-left hover:border-white/30 hover:bg-white/5"
    >
      <LiveComposition
        composition={c}
        props={compositionBrand(edit, c)}
        width={200}
      />
      <span className="text-xs font-medium">{c.label}</span>
      <span className="text-[11px] text-muted-foreground">
        {c.description ?? from}
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit composition" : "Compositions"}
          </DialogTitle>
          <DialogDescription>
            HTML pages written by you or an AI, rendered frame by frame into a
            layer. A page animates with CSS, or draws each frame in{" "}
            <code>window.setT(t)</code>. No network, no Math.random: the same
            frame every time. Scenes are built in: 3D devices, cards, counters
            and cursors in the look of SaaS ads; a “screen” takes the file name
            of a montage asset.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                This video
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const c = fresh();
                  setDraft(c);
                  setProps(resolveCompositionProps(c, {}));
                }}
              >
                New composition
              </Button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {(list.data?.video ?? []).map((c) => card(c, "In this video"))}
              {list.data && list.data.video.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  None yet. Start from a new one, or convert a block layer
                  (Effect Controls, “Convert to composition”).
                </span>
              ) : null}
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Scenes
            </span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {SCENES.map((s) =>
                card(sceneFor(s.id, edit.aspect) ?? s, "Scene"),
              )}
            </div>
            {list.data?.project ? (
              <>
                <span className="text-xs font-medium text-muted-foreground">
                  Project library
                </span>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {(list.data.library ?? []).map((c) =>
                    card(c, "Project library"),
                  )}
                  {list.data.library.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      Empty. “Save to project library” keeps a composition for
                      every video of the project.
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto md:grid-cols-[1fr_340px]">
            <div className="flex min-h-0 flex-col gap-3">
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-black/30 p-4">
                <LiveComposition
                  composition={draft}
                  props={props}
                  width={560}
                />
                <span className="text-[11px] text-muted-foreground">
                  Preview, looping. The video is rendered when you add it.
                </span>
              </div>
              <label
                htmlFor="composition-html"
                className="text-[11px] text-muted-foreground"
              >
                HTML (props as {"{{name}}"} or window.__props; frames by
                window.setT)
              </label>
              <Textarea
                id="composition-html"
                value={draft.html}
                onChange={(e) => set({ html: e.target.value })}
                spellCheck={false}
                rows={14}
                className="min-h-[200px] font-mono text-[11px] leading-snug"
              />
              {issues.length > 0 ? (
                <ul className="text-[11px] text-destructive">
                  {issues.map((i) => (
                    <li key={`${i.path}-${i.message}`}>
                      {i.path}: {i.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate();
              }}
            >
              <Field label="Name" id="composition-label">
                <Input
                  id="composition-label"
                  value={draft.label}
                  onChange={(e) => set({ label: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label="Id" id="composition-id">
                <Input
                  id="composition-id"
                  value={draft.id}
                  disabled={!!editing}
                  onChange={(e) => set({ id: e.target.value })}
                  className="h-8 font-mono text-xs"
                />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Width" id="composition-w">
                  <Input
                    id="composition-w"
                    type="number"
                    value={draft.box.width}
                    onChange={(e) =>
                      set({
                        box: { ...draft.box, width: Number(e.target.value) },
                      })
                    }
                    className="h-8 text-xs"
                  />
                </Field>
                <Field label="Height" id="composition-h">
                  <Input
                    id="composition-h"
                    type="number"
                    value={draft.box.height}
                    onChange={(e) =>
                      set({
                        box: { ...draft.box, height: Number(e.target.value) },
                      })
                    }
                    className="h-8 text-xs"
                  />
                </Field>
                <Field label="Seconds" id="composition-d">
                  <Input
                    id="composition-d"
                    type="number"
                    step={0.1}
                    value={draft.duration}
                    onChange={(e) => set({ duration: Number(e.target.value) })}
                    className="h-8 text-xs"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.transparent}
                  onChange={(e) => set({ transparent: e.target.checked })}
                />
                Transparent background
              </label>
              {draft.props.length > 0 ? (
                <span className="mt-1 text-[11px] font-medium text-muted-foreground">
                  Settings
                </span>
              ) : null}
              {draft.props.map((spec) => {
                const value = props[spec.name] ?? spec.default;
                const setValue = (v: string | number) =>
                  setProps((p) => ({ ...p, [spec.name]: v }));
                return (
                  <Field
                    key={spec.name}
                    label={spec.label}
                    id={`composition-prop-${spec.name}`}
                  >
                    {spec.type === "longtext" ? (
                      <Textarea
                        id={`composition-prop-${spec.name}`}
                        value={String(value)}
                        onChange={(e) => setValue(e.target.value)}
                        rows={3}
                        className="text-xs"
                      />
                    ) : spec.type === "color" ? (
                      <input
                        id={`composition-prop-${spec.name}`}
                        type="color"
                        value={String(value)}
                        onChange={(e) => setValue(e.target.value)}
                        className="h-8 w-full cursor-pointer rounded border bg-transparent"
                      />
                    ) : (
                      <Input
                        id={`composition-prop-${spec.name}`}
                        type={spec.type === "number" ? "number" : "text"}
                        value={String(value)}
                        onChange={(e) =>
                          setValue(
                            spec.type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                          )
                        }
                        className="h-8 text-xs"
                      />
                    )}
                  </Field>
                );
              })}
              <div className="mt-2 flex flex-wrap gap-2">
                {!editing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    Back
                  </Button>
                ) : null}
                {list.data?.project ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={toLibrary.isPending || issues.length > 0}
                    onClick={() => toLibrary.mutate()}
                  >
                    {toLibrary.isPending ? <Spinner /> : null}
                    Save to project library
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={run.isPending || issues.length > 0}
                >
                  {run.isPending ? <Spinner /> : null}
                  {editing ? "Render again" : "Add to video"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
