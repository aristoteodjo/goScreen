import type { QcReport } from "@goscreen/speech";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Section } from "./PanelKit";
import { useSession } from "./session";
import { qcEdit } from "./speech";
import { useEdit } from "./store";

// Quality control of a talking-head montage: the mechanical checks a person
// would otherwise do by eye, as a pass / fail table, plus the real numbers.

const isReport = (r: unknown): r is QcReport =>
  typeof r === "object" &&
  r !== null &&
  Array.isArray((r as QcReport).checks) &&
  typeof (r as QcReport).pass === "boolean";

export function QcPanel() {
  const videoPath = useSession((s) => s.videoPath);
  const [loop, setLoop] = useState(false);
  const [report, setReport] = useState<QcReport | null>(null);
  const run = useMutation({
    mutationFn: () => qcEdit(videoPath, useEdit.getState().edit, { loop }),
    onSuccess: (r) => {
      if (!isReport(r.report)) return;
      setReport(r.report);
      toast[r.report.pass ? "success" : "warning"](
        r.report.pass
          ? "QC passed"
          : `QC: ${r.report.stats.failed} check${r.report.stats.failed > 1 ? "s" : ""} failed`,
      );
    },
    onError: (e) =>
      toast.error("QC could not run", {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  const stats = report?.stats;

  return (
    <div className="flex flex-col gap-3 p-3" data-ai="qc">
      <Section
        title="Quality control"
        hint="Synced layers within 2 frames of their word, no text over the face, safe zone, no cut inside a word, loop, no empty clip. Writes qc.md next to the take."
      />
      <Section
        title="Meant to loop"
        hint="The last frame should match the first."
        aside={<Switch checked={loop} onCheckedChange={setLoop} />}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={run.isPending || !videoPath}
        onClick={() => run.mutate()}
      >
        {run.isPending ? "Checking…" : "Run QC"}
      </Button>
      {report ? (
        <table className="w-full text-[11px]">
          <tbody>
            {report.checks.map((c) => (
              <tr key={c.id} className="border-t border-white/5 align-top">
                <td
                  className={cn(
                    "py-1.5 pr-2 font-mono uppercase",
                    c.pass ? "text-emerald-400" : "text-red-400",
                  )}
                >
                  {c.pass ? "pass" : "fail"}
                </td>
                <td className="py-1.5">
                  <div>{c.label}</div>
                  <div className="text-muted-foreground">{c.detail}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {stats ? (
        <p className="text-[11px] text-muted-foreground">
          {stats.durationSeconds.toFixed(1)} s, {stats.clips} clips,{" "}
          {stats.words} words, {stats.syncedEffects} synced effects,{" "}
          {stats.failed} failed.
        </p>
      ) : null}
    </div>
  );
}
