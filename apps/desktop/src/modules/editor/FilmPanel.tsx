import { applyFilm, type Film, filmSchema } from "@goscreen/scenario";
import { useMutation } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { exportVariants, type Resolution, type Variant } from "./exportCurrent";
import { Section, SliderRow, useChange } from "./PanelKit";
import { useEdit } from "./store";

// The film's settings, like a Remotion composition's props: change one and
// the montage follows at once (undoable). Only what the scenes made changes.

const ASPECTS: Variant["aspect"][] = ["9:16", "16:9", "1:1", "4:5"];
const FONTS = [
  "Inter",
  "Avenir Next",
  "Futura",
  "Helvetica Neue",
  "Georgia",
  "Menlo",
];

export function FilmPanel() {
  const stored = useEdit((s) => s.edit.film);
  const change = useChange();
  if (!stored)
    return (
      <Section
        title="Film"
        hint="Film settings come with videos recorded from a scenario or a VSL flow."
      />
    );
  const parsed = filmSchema.safeParse(stored.settings);
  const film: Film = parsed.success ? parsed.data : filmSchema.parse({});
  const set = (patch: Partial<Film>, key: string) => {
    const next = filmSchema.safeParse({ ...film, ...patch });
    if (!next.success) return;
    change((ed) => applyFilm(ed, next.data, stored.locale), `film-${key}`);
  };
  const card = (
    which: "intro" | "outro",
    patch: { title?: string; subtitle?: string },
  ) => {
    const current = film[which] ?? { title: "", subtitle: "", duration: 3 };
    const next = { ...current, ...patch };
    set({ [which]: next.title.trim() ? next : undefined }, which);
  };

  return (
    <>
      <Section title="Format">
        <ToggleGroup
          type="single"
          value={film.aspect}
          onValueChange={(v) =>
            v && set({ aspect: v as Film["aspect"] }, "aspect")
          }
          className="w-full"
        >
          {ASPECTS.map((a) => (
            <ToggleGroupItem key={a} value={a} className="flex-1 text-[11px]">
              {a}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
      <Section title="Captions">
        <ToggleGroup
          type="single"
          value={film.captions}
          onValueChange={(v) =>
            v && set({ captions: v as Film["captions"] }, "captions")
          }
          className="w-full"
        >
          <ToggleGroupItem value="top" className="flex-1 text-[11px]">
            Top
          </ToggleGroupItem>
          <ToggleGroupItem value="bottom" className="flex-1 text-[11px]">
            Bottom
          </ToggleGroupItem>
          <ToggleGroupItem value="none" className="flex-1 text-[11px]">
            Hidden
          </ToggleGroupItem>
        </ToggleGroup>
      </Section>
      <Section title="Colours">
        <div className="grid grid-cols-3 gap-2">
          {(["background", "ink", "accent"] as const).map((k) => (
            <label
              key={k}
              className="flex flex-col gap-1 text-[11px] text-muted-foreground"
            >
              {k === "background"
                ? "Background"
                : k === "ink"
                  ? "Text"
                  : "Accent"}
              <input
                type="color"
                value={film[k]}
                onChange={(e) => set({ [k]: e.target.value }, k)}
                className="h-8 w-full cursor-pointer rounded border bg-transparent"
              />
            </label>
          ))}
        </div>
      </Section>
      <Section title="Font">
        <div className="flex flex-wrap gap-1.5">
          {FONTS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => set({ font: f }, "font")}
              style={{ fontFamily: f }}
              className={`rounded-md border px-2 py-1 text-xs ${film.font === f ? "border-white/40 bg-white/10" : "hover:bg-white/5"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Zoom on taps" hint="1× turns the scene zooms off.">
        <SliderRow
          value={film.zoom}
          min={1}
          max={2.5}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(zoom) => set({ zoom }, "zoom")}
        />
      </Section>
      <Section title="Opening card" hint="Empty title: no card.">
        <CardFields value={film.intro} onChange={(p) => card("intro", p)} />
      </Section>
      <Section title="Closing card" hint="Empty title: no card.">
        <CardFields value={film.outro} onChange={(p) => card("outro", p)} />
      </Section>
      <VariantsSection current={film.aspect} />
    </>
  );
}

function CardFields({
  value,
  onChange,
}: {
  value: Film["intro"];
  onChange: (p: { title?: string; subtitle?: string }) => void;
}) {
  const [title, setTitle] = useState(value?.title ?? "");
  const [subtitle, setSubtitle] = useState(value?.subtitle ?? "");
  useEffect(() => {
    setTitle(value?.title ?? "");
    setSubtitle(value?.subtitle ?? "");
  }, [value?.title, value?.subtitle]);
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={title}
        placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== (value?.title ?? "") && onChange({ title })}
        className="h-8 text-xs"
      />
      <Input
        value={subtitle}
        placeholder="Subtitle"
        onChange={(e) => setSubtitle(e.target.value)}
        onBlur={() =>
          subtitle !== (value?.subtitle ?? "") && onChange({ subtitle })
        }
        className="h-8 text-xs"
      />
    </div>
  );
}

function VariantsSection({ current }: { current: Variant["aspect"] }) {
  const [picked, setPicked] = useState<Set<Variant["aspect"]>>(
    () =>
      new Set(
        ASPECTS.filter((a) => a !== current)
          .slice(0, 2)
          .concat(current),
      ),
  );
  const [resolution, setResolution] = useState<Resolution>("1080");
  const run = useMutation({
    mutationFn: () =>
      exportVariants(
        ASPECTS.filter((a) => picked.has(a)),
        { resolution, fps: 30 },
      ),
    onSuccess: (files) => {
      if (!Array.isArray(files) || files.length === 0) return;
      toast.success(
        `${files.length} format${files.length > 1 ? "s" : ""} exported`,
        {
          action: {
            label: "Show in Finder",
            onClick: () => void revealItemInDir(files[0].file),
          },
        },
      );
    },
  });
  return (
    <Section
      title="Export several formats"
      hint="The same film for every channel: each format is laid out by the film's rules. The montage on screen does not change."
    >
      <div className="grid grid-cols-2 gap-2">
        {ASPECTS.map((a) => (
          <label
            key={a}
            htmlFor={`variant-${a}`}
            className="flex items-center gap-2 text-xs"
          >
            <Checkbox
              id={`variant-${a}`}
              checked={picked.has(a)}
              onCheckedChange={(v) =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (v === true) next.add(a);
                  else next.delete(a);
                  return next;
                })
              }
            />
            {a}
            <span className="text-muted-foreground">
              {a === "9:16"
                ? "Stories, Reels"
                : a === "16:9"
                  ? "Web, YouTube"
                  : a === "1:1"
                    ? "Feed"
                    : "Feed, portrait"}
            </span>
          </label>
        ))}
      </div>
      <ToggleGroup
        type="single"
        value={resolution}
        onValueChange={(v) => v && setResolution(v as Resolution)}
        className="w-full"
      >
        <ToggleGroupItem value="720" className="flex-1 text-[11px]">
          720p
        </ToggleGroupItem>
        <ToggleGroupItem value="1080" className="flex-1 text-[11px]">
          1080p
        </ToggleGroupItem>
        <ToggleGroupItem value="2160" className="flex-1 text-[11px]">
          4K
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        size="sm"
        disabled={picked.size === 0 || run.isPending}
        onClick={() => run.mutate()}
      >
        {run.isPending ? <Spinner /> : null}
        Export {picked.size} format{picked.size === 1 ? "" : "s"}
      </Button>
    </Section>
  );
}
