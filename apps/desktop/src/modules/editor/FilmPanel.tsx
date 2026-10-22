import {
  adoptFilm,
  applyFilm,
  type Film,
  filmSchema,
} from "@goscreen/scenario";
import { useMutation } from "@tanstack/react-query";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInspirationDialog } from "@/modules/inspiration/InspirationDialog";
import { useInspirations } from "@/modules/inspiration/library";
import { FILM_FONTS } from "./filmFonts";
import { exportVariants, type Resolution, type Variant } from "./exportCurrent";
import { Section, SliderRow, useChange } from "./PanelKit";
import { useEdit } from "./store";

// The film's settings, like a Remotion composition's props: change one and
// the montage follows at once (undoable). Only what the scenes made changes.

const ASPECTS: Variant["aspect"][] = ["9:16", "16:9", "1:1", "4:5"];

export function FilmPanel() {
  const stored = useEdit((s) => s.edit.film);
  const change = useChange();
  if (!stored) return <MakeFilm />;
  const parsed = filmSchema.safeParse(stored.settings);
  const film: Film = parsed.success ? parsed.data : filmSchema.parse({});
  const set = (patch: Partial<Film>, key: string) => {
    const next = filmSchema.safeParse({ ...film, ...patch });
    if (!next.success) return;
    change((ed) => applyFilm(ed, next.data, stored.locale), `film-${key}`);
  };
  const card = (
    which: "intro" | "outro",
    patch: { title?: string; subtitle?: string; eyebrow?: string },
  ) => {
    const current = film[which] ?? { title: "", subtitle: "", duration: 3 };
    const next = { ...current, ...patch };
    set({ [which]: next.title.trim() ? next : undefined }, which);
  };

  return (
    <>
      <InspirationSection slug={film.inspiration} />
      <Section
        title="Look"
        hint="Showcase: the device framed under a numbered title, brand cards. Plain: one centered caption."
      >
        <ToggleGroup
          type="single"
          value={film.look}
          onValueChange={(v) => v && set({ look: v as Film["look"] }, "look")}
          className="w-full"
        >
          <ToggleGroupItem value="showcase" className="flex-1 text-[11px]">
            Showcase
          </ToggleGroupItem>
          <ToggleGroupItem value="plain" className="flex-1 text-[11px]">
            Plain
          </ToggleGroupItem>
        </ToggleGroup>
        <TextField
          label="Chapter label"
          placeholder="Buyer → BUYER · 2/11"
          value={film.label}
          onCommit={(label) => set({ label }, "label")}
        />
        <TextField
          label="Brand on the cards"
          placeholder="Your product"
          value={film.brand}
          onCommit={(brand) => set({ brand }, "brand")}
        />
      </Section>
      <Section
        title="Screen"
        hint="Premium: the SaaS enhanced screen recording (frameless glass, outline, lean, pan-in, ripple clicks)."
      >
        <ToggleGroup
          type="single"
          value={film.screen}
          onValueChange={(v) =>
            v && set({ screen: v as Film["screen"] }, "screen")
          }
          className="w-full"
        >
          <ToggleGroupItem value="framed" className="flex-1 text-[11px]">
            Framed device
          </ToggleGroupItem>
          <ToggleGroupItem value="premium" className="flex-1 text-[11px]">
            Premium
          </ToggleGroupItem>
        </ToggleGroup>
      </Section>
      <Section
        title="Backdrop"
        hint="Moving cinematic background built from the accent colour, or the flat film colour."
      >
        <ToggleGroup
          type="single"
          value={film.backdrop}
          onValueChange={(v) =>
            v && set({ backdrop: v as Film["backdrop"] }, "backdrop")
          }
          className="w-full"
        >
          {(["flat", "circles", "blob", "waves", "beam", "ring"] as const).map((b) => (
            <ToggleGroupItem key={b} value={b} className="flex-1 text-[11px]">
              {b[0].toUpperCase() + b.slice(1)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
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
          {FILM_FONTS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => set({ font: f }, "font")}
              style={{ fontFamily: f }}
              className={`rounded-md border px-2 py-1 text-xs ${film.font === f ? "border-white/40 bg-white/10" : "hover:bg-white/5"}`}
            >
              {f.replace(" Variable", "")}
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
      <Section
        title="Opening card"
        hint="Empty title: no card. *Words between stars* take the accent colour."
      >
        <CardFields value={film.intro} onChange={(p) => card("intro", p)} />
      </Section>
      <Section title="Closing card" hint="Empty title: no card.">
        <CardFields value={film.outro} onChange={(p) => card("outro", p)} />
      </Section>
      <VariantsSection current={film.aspect} />
    </>
  );
}

/** A text setting, applied when the field is left (one undo step). */
function TextField({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const id = useId();
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-8 text-xs text-foreground"
      />
    </div>
  );
}

/** Any video can become a film: its cards and scene texts are kept. */
function MakeFilm() {
  const edit = useEdit((s) => s.edit);
  const change = useChange();
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const id = useId();
  const make = () => {
    const firstText = edit.overlays.find((o) => o.kind === "text");
    const bg =
      edit.background.kind === "color" ? edit.background.value : undefined;
    const film = filmSchema.parse({
      ...(bg ? { background: bg } : {}),
      ...(firstText?.kind === "text"
        ? { ink: firstText.style.color, font: firstText.style.font }
        : {}),
      aspect: ["9:16", "16:9", "1:1", "4:5"].includes(edit.aspect)
        ? edit.aspect
        : "9:16",
      label,
      brand,
    });
    change((ed) => adoptFilm(ed, film, navigator.language || "en-US"), "film");
  };
  return (
    <Section
      title="Make it a film"
      hint="Lays the video out like a VSL: the device framed under each scene's title, numbered chapters, brand cards at both ends. The texts that start with a clip become its title. Undo brings everything back."
    >
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <label htmlFor={`${id}-label`}>Chapter label</label>
        <Input
          id={`${id}-label`}
          value={label}
          placeholder="Buyer"
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 text-xs text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <label htmlFor={`${id}-brand`}>Brand</label>
        <Input
          id={`${id}-brand`}
          value={brand}
          placeholder="Your product"
          onChange={(e) => setBrand(e.target.value)}
          className="h-8 text-xs text-foreground"
        />
      </div>
      <Button size="sm" onClick={make}>
        Make it a film
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => useInspirationDialog.getState().show()}
      >
        Start from an inspiration…
      </Button>
    </Section>
  );
}

/** The direction the film follows, credited, or a way to pick one. */
function InspirationSection({ slug }: { slug: string | undefined }) {
  const { data: all } = useInspirations();
  const followed = slug ? all?.find((i) => i.slug === slug) : undefined;
  return (
    <Section
      title="Inspiration"
      hint="A shared prompt as the film's direction: its format, colours and type; its brief tells an AI the rest."
    >
      {slug ? (
        <p className="text-[11px] text-muted-foreground">
          Following{" "}
          {followed?.post_url ? (
            <button
              type="button"
              className="text-foreground underline"
              onClick={() => void openUrl(followed.post_url)}
            >
              @{followed.author}
            </button>
          ) : (
            <span className="text-foreground">{followed ? `@${followed.author}` : slug}</span>
          )}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => useInspirationDialog.getState().show()}
      >
        {slug ? "Change inspiration…" : "Browse inspirations…"}
      </Button>
    </Section>
  );
}

function CardFields({
  value,
  onChange,
}: {
  value: Film["intro"];
  onChange: (p: {
    title?: string;
    subtitle?: string;
    eyebrow?: string;
  }) => void;
}) {
  const [title, setTitle] = useState(value?.title ?? "");
  const [subtitle, setSubtitle] = useState(value?.subtitle ?? "");
  const [eyebrow, setEyebrow] = useState(value?.eyebrow ?? "");
  useEffect(() => {
    setTitle(value?.title ?? "");
    setSubtitle(value?.subtitle ?? "");
    setEyebrow(value?.eyebrow ?? "");
  }, [value?.title, value?.subtitle, value?.eyebrow]);
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={eyebrow}
        placeholder="Eyebrow (small capitals above)"
        onChange={(e) => setEyebrow(e.target.value)}
        onBlur={() =>
          eyebrow !== (value?.eyebrow ?? "") && onChange({ eyebrow })
        }
        className="h-8 text-xs"
      />
      <Input
        value={title}
        placeholder="Title: *stars* colour words"
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
