import type { EditState } from "@goscreen/render-engine";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Section, SliderRow } from "./PanelKit";
import { useSession } from "./session";
import {
  applyTakes,
  faceZoomsEdit,
  proposeTakes,
  type TakesProposal,
  tightCutEdit,
  transcribeTake,
} from "./speech";
import { useEdit } from "./store";

// A talking head's take: the voice leads the cut, word by word. Every step
// is one undoable change of the montage; the files it reads and writes live
// next to the take (words, envelope, takes.md).

const apply = (next: EditState) =>
  useEdit.getState().change(() => next, "speech");

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SpeechSection() {
  const videoPath = useSession((s) => s.videoPath);
  const [takesOpen, setTakesOpen] = useState(false);
  const [minPause, setMinPause] = useState(0.15);

  const transcribe = useMutation({
    mutationFn: () => transcribeTake(videoPath),
    onSuccess: (r) => {
      if (typeof r.words !== "number") return;
      toast.success(
        `${r.words} words heard (${r.language || "language unknown"}), ${r.snapped} snapped to the sound`,
      );
    },
    onError: (e) =>
      toast.error("The voice could not be transcribed", {
        description: describe(e),
      }),
  });
  const tight = useMutation({
    mutationFn: () =>
      tightCutEdit(videoPath, useEdit.getState().edit, minPause),
    onSuccess: (r) => {
      if (typeof r.pausesCut !== "number") return;
      apply(r.edit);
      toast.success(
        r.pausesCut > 0
          ? `${r.pausesCut} pauses cut, ${r.removedSeconds.toFixed(1)} s removed`
          : "No pause long enough to cut",
      );
    },
    onError: (e) =>
      toast.error("The tight cut failed", { description: describe(e) }),
  });
  const faces = useMutation({
    mutationFn: () => faceZoomsEdit(videoPath, useEdit.getState().edit),
    onSuccess: (r) => {
      if (typeof r.zooms !== "number") return;
      apply(r.edit);
      toast.success(
        `${r.zooms} close framings on ${r.clips} clips (${r.faces} faces found)`,
      );
    },
    onError: (e) =>
      toast.error("Face zooms failed", { description: describe(e) }),
  });

  return (
    <Section
      title="Talking head"
      hint="Transcribe the voice, keep the best take of each line, cut the pauses, frame the face. Each step is undoable."
    >
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={transcribe.isPending}
          onClick={() => transcribe.mutate()}
        >
          {transcribe.isPending ? "Listening…" : "Transcribe"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTakesOpen(true)}
        >
          Pick takes…
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={tight.isPending}
          onClick={() => tight.mutate()}
        >
          Tight cut
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={faces.isPending}
          onClick={() => faces.mutate()}
        >
          {faces.isPending ? "Looking…" : "Face zooms"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Pauses longer than</p>
      <SliderRow
        value={minPause}
        min={0.05}
        max={1}
        step={0.05}
        format={(v) => `${v.toFixed(2)} s`}
        onChange={setMinPause}
      />
      <TakesDialog
        open={takesOpen}
        onOpenChange={setTakesOpen}
        videoPath={videoPath}
      />
    </Section>
  );
}

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};

/** The script line by line, the takes found for each, and the one kept. */
function TakesDialog({
  open,
  onOpenChange,
  videoPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoPath: string;
}) {
  const [script, setScript] = useState("");
  const [proposal, setProposal] = useState<TakesProposal | null>(null);
  const find = useMutation({
    mutationFn: () => {
      const lines = script
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return proposeTakes(videoPath, lines.length > 0 ? lines : undefined);
    },
    onSuccess: (p) => {
      if (!Array.isArray(p.picked)) return;
      setProposal(p);
      if (!script.trim()) setScript(p.script.join("\n"));
    },
    onError: (e) =>
      toast.error("The takes could not be found", {
        description: describe(e),
      }),
  });
  const keep = useMutation({
    mutationFn: (p: TakesProposal) =>
      applyTakes(videoPath, useEdit.getState().edit, p),
    onSuccess: (r) => {
      if (typeof r.clips !== "number") return;
      apply(r.edit);
      toast.success(`${r.clips} takes kept; takes.md written`);
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error("The takes could not be applied", {
        description: describe(e),
      }),
  });
  const stats = proposal?.stats;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick takes</DialogTitle>
          <DialogDescription>
            One script line per row. Leave it empty to rebuild the script from
            the words. The last clean take of each line is kept; restarts are
            removed.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Hello, this is goScreen.&#10;It films any site on any device."
          className="min-h-28 font-mono text-xs"
        />
        {proposal ? (
          <div className="max-h-72 overflow-auto rounded-md border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Line</th>
                  <th className="p-2">Take</th>
                  <th className="p-2">Time</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {proposal.picked.map((p) => (
                  <tr
                    key={p.line}
                    className={cn(
                      "border-t border-white/5 align-top",
                      p.take === null && "text-red-400",
                    )}
                  >
                    <td className="p-2">
                      {p.line + 1}. {p.text}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {p.take ? `${p.take.take}/${p.rejected.length + 1}` : "—"}
                    </td>
                    <td className="p-2 whitespace-nowrap font-mono">
                      {p.take
                        ? `${clock(p.take.start)} → ${clock(p.take.end)}`
                        : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {stats ? (
          <p className="text-[11px] text-muted-foreground">
            Raw {stats.rawSeconds.toFixed(1)} s, kept{" "}
            {stats.keptSeconds.toFixed(1)} s, {stats.takesRemoved} takes and{" "}
            {stats.restartsRemoved} restarts removed
            {stats.linesMissing
              ? `, ${stats.linesMissing} lines not found`
              : ""}
            .
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={find.isPending}
            onClick={() => find.mutate()}
          >
            {find.isPending ? "Searching…" : "Find takes"}
          </Button>
          <Button
            disabled={!proposal || keep.isPending}
            onClick={() => proposal && keep.mutate(proposal)}
          >
            Keep these takes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
