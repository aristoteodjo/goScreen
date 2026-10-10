import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/lib/ipc";
import { normalizeUrl } from "@/lib/url";
import { useCaptureSettings } from "@/modules/recording/settings";
import type { CaptureControls } from "@/modules/recording/useCapture";
import { useProject } from "@/modules/studio/store/project";
import { DEFAULT_TOUR, pageLabel, tourSeconds } from "./plan";
import { runTour } from "./runTour";
import { useTour } from "./store";

// Records a whole site in one take: pick pages, set the pace, record.
export function SiteTourDialog({ capture }: { capture: CaptureControls }) {
  const open = useTour((s) => s.dialogOpen);
  const set = useTour((s) => s.set);
  const [site, setSite] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scrollSeconds, setScrollSeconds] = useState(
    DEFAULT_TOUR.scrollSeconds,
  );
  const [pauseSeconds, setPauseSeconds] = useState(DEFAULT_TOUR.pauseSeconds);

  const discover = useMutation({
    mutationFn: (url: string) => ipc.sitePages(url),
    onSuccess: (found) => {
      if (!Array.isArray(found) || found.length === 0) {
        toast.error("No page found on this site.");
        return;
      }
      setPages(found);
      setPicked(new Set(found));
    },
    onError: (e) =>
      toast.error("Could not read the site", { description: String(e) }),
  });

  const tour = useMutation({
    mutationFn: (selection: string[]) =>
      runTour(selection, { scrollSeconds, pauseSeconds }, capture),
    onError: (e) =>
      toast.error("Site tour stopped", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  const onOpenChange = (next: boolean) => {
    if (next && pages.length === 0) setSite(useProject.getState().url);
    set({ dialogOpen: next });
  };

  const find = () => {
    const url = normalizeUrl(site);
    if (!url) {
      toast.error("Enter a valid http or https address.");
      return;
    }
    setSite(url);
    discover.mutate(url);
  };

  const selection = pages.filter((p) => picked.has(p));
  const toggle = (page: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(page);
      else next.delete(page);
      return next;
    });

  const start = () => {
    set({ dialogOpen: false });
    useCaptureSettings.getState().setBarOpen(false);
    tour.mutate(selection);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Site tour</DialogTitle>
          <DialogDescription>
            Records every page in one take: each one opens on all synced
            devices, scrolls gently to the bottom, then the next. Uses the
            capture settings of the bar (zone, camera, microphone).
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <Input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="https://your-site.com"
            spellCheck={false}
            className="h-9 font-mono text-xs"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={discover.isPending}
          >
            {discover.isPending ? <Spinner /> : null}
            Find pages
          </Button>
        </form>

        {pages.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {selection.length} of {pages.length} pages
              </span>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() =>
                  setPicked(
                    selection.length === pages.length
                      ? new Set()
                      : new Set(pages),
                  )
                }
              >
                {selection.length === pages.length
                  ? "Select none"
                  : "Select all"}
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border">
              {pages.map((page, i) => (
                <label
                  key={page}
                  htmlFor={`tour-page-${i}`}
                  className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 text-xs last:border-0 hover:bg-white/5"
                >
                  <Checkbox
                    id={`tour-page-${i}`}
                    checked={picked.has(page)}
                    onCheckedChange={(v) => toggle(page, v === true)}
                  />
                  <span className="truncate font-mono">{pageLabel(page)}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Pace
            label="Scroll per page"
            value={scrollSeconds}
            min={2}
            max={20}
            onChange={setScrollSeconds}
          />
          <Pace
            label="Pause top and bottom"
            value={pauseSeconds}
            min={0}
            max={5}
            step={0.5}
            onChange={setPauseSeconds}
          />
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selection.length > 0
              ? `About ${Math.round(tourSeconds(selection.length, { scrollSeconds, pauseSeconds }))} s of video`
              : ""}
          </span>
          <Button
            onClick={start}
            disabled={
              selection.length === 0 || tour.isPending || capture.recording
            }
            className="bg-rec text-white hover:bg-rec/90"
          >
            Record tour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pace({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}s</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
