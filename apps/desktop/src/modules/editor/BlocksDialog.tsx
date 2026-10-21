import {
  type Block,
  BLOCKS,
  blockById,
  renderHtml,
  resolveProps,
} from "@goscreen/blocks";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { addBlockHere, brandProps, pixelSize, updateBlock } from "./blocks";
import { useSession } from "./session";
import { useEdit } from "./store";

// The block gallery: every block plays live in its card, already in the
// film's colours; pick one, adjust it with a live preview, add it.

type DialogState = {
  open: boolean;
  // Where a right-click asked for it (fractions of the frame).
  at: { x: number; y: number } | null;
  // Editing an existing block layer instead of adding one.
  editing: string | null;
  // A block chosen from the Project panel: opens on its settings.
  block: string | null;
  show: (o?: {
    at?: { x: number; y: number };
    editing?: string;
    block?: string;
  }) => void;
  close: () => void;
};

export const useBlocksDialog = create<DialogState>((set) => ({
  open: false,
  at: null,
  editing: null,
  block: null,
  show: (o) =>
    set({
      open: true,
      at: o?.at ?? null,
      editing: o?.editing ?? null,
      block: o?.block ?? null,
    }),
  close: () => set({ open: false, editing: null, block: null }),
}));

/** A block playing in a sandboxed frame, scaled into its card; it loops. */
export function Live({
  block,
  props,
  width,
  className,
}: {
  block: Block;
  props: Record<string, string | number>;
  width: number;
  className?: string;
}) {
  const edit = useEdit((s) => s.edit);
  const source = useSession((s) => s.source);
  const size = pixelSize(edit, block.box, source);
  const html = renderHtml(block, props, size);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setRound((r) => r + 1),
      (block.duration + 1.2) * 1000,
    );
    return () => clearInterval(t);
  }, [block.duration]);
  const scale = width / size.width;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md",
        block.transparent &&
          "bg-[conic-gradient(#3f3f46_25%,#52525b_0_50%,#3f3f46_0_75%,#52525b_0)] bg-[length:16px_16px]",
        className,
      )}
      style={{ width, height: size.height * scale }}
    >
      <iframe
        key={`${round}-${html.length}`}
        title={block.label}
        sandbox=""
        srcDoc={html}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{
          width: size.width,
          height: size.height,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

/** A block playing live in a card (Project panel, gallery). */
export function BlockThumb({ block, width }: { block: Block; width: number }) {
  const edit = useEdit((s) => s.edit);
  return <Live block={block} props={brandProps(edit, block)} width={width} />;
}

export function BlocksDialog() {
  const open = useBlocksDialog((s) => s.open);
  const editing = useBlocksDialog((s) => s.editing);
  const preset = useBlocksDialog((s) => s.block);
  const at = useBlocksDialog((s) => s.at);
  const { close } = useBlocksDialog.getState();
  const edit = useEdit((s) => s.edit);
  const brandFor = (b: Block) => brandProps(edit, b);
  const editingLayer = editing
    ? edit.overlays.find((o) => o.id === editing)
    : undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const [props, setProps] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (!open) return;
    if (
      editingLayer?.kind === "video" &&
      editingLayer.source &&
      "block" in editingLayer.source
    ) {
      setPicked(editingLayer.source.block);
      setProps(editingLayer.source.props);
    } else {
      const chosen = preset ? blockById(preset) : undefined;
      setPicked(chosen?.id ?? null);
      setProps(
        chosen
          ? {
              ...resolveProps(chosen, {}),
              ...brandProps(useEdit.getState().edit, chosen),
            }
          : {},
      );
    }
  }, [open, editingLayer, preset]);

  const block = picked ? blockById(picked) : undefined;

  const add = useMutation({
    mutationFn: async () => {
      if (!block) return;
      if (editing) {
        const { videoPath } = useSession.getState();
        const next = await updateBlock(
          videoPath,
          useEdit.getState().edit,
          editing,
          props,
        );
        useEdit.getState().change(() => next, "block");
      } else
        await addBlockHere(
          block.id,
          { ...brandFor(block), ...props },
          at ?? undefined,
        );
    },
    onSuccess: () => {
      close();
      toast.success(editing ? "Block updated" : "Block added at the playhead");
    },
    onError: (e) =>
      toast.error("The block could not be rendered", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit block" : "Blocks"}</DialogTitle>
          <DialogDescription>
            Animated titles, captions, numbers and calls to action, made in HTML
            and rendered frame by frame into a layer. They already use the
            film's colours; everything is editable.
          </DialogDescription>
        </DialogHeader>

        {!block ? (
          <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 overflow-y-auto pr-1">
            {BLOCKS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setPicked(b.id);
                  setProps({ ...resolveProps(b, {}), ...brandFor(b) });
                }}
                className="flex flex-col gap-2 rounded-lg border p-2 text-left hover:border-white/30 hover:bg-white/5"
              >
                <Live block={b} props={brandFor(b)} width={200} />
                <span className="text-xs font-medium">{b.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {b.description}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto md:grid-cols-[1fr_300px]">
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-black/30 p-4">
              <Live block={block} props={props} width={520} />
              <span className="text-[11px] text-muted-foreground">
                Preview, looping. The video is rendered when you add it.
              </span>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              {block.props.map((spec) => {
                const value = props[spec.name] ?? spec.default;
                const setValue = (v: string | number) =>
                  setProps((p) => ({ ...p, [spec.name]: v }));
                return (
                  <div
                    key={spec.name}
                    className="flex flex-col gap-1 text-[11px]"
                  >
                    <label
                      htmlFor={`block-prop-${spec.name}`}
                      className="text-muted-foreground"
                    >
                      {spec.label}
                    </label>
                    {spec.type === "longtext" ? (
                      <Textarea
                        id={`block-prop-${spec.name}`}
                        value={String(value)}
                        onChange={(e) => setValue(e.target.value)}
                        rows={4}
                        className="text-xs"
                      />
                    ) : spec.type === "color" ? (
                      <input
                        id={`block-prop-${spec.name}`}
                        type="color"
                        value={String(value)}
                        onChange={(e) => setValue(e.target.value)}
                        className="h-8 w-full cursor-pointer rounded border bg-transparent"
                      />
                    ) : (
                      <Input
                        id={`block-prop-${spec.name}`}
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
                  </div>
                );
              })}
              <div className="mt-2 flex gap-2">
                {!editing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPicked(null)}
                  >
                    Back
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={add.isPending}
                >
                  {add.isPending ? <Spinner /> : null}
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
