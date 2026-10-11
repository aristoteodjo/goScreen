import {
  EXAMPLE_SCENARIO,
  parseScenario,
  requiredVars,
  resolveVars,
  stepLabel,
} from "@goscreen/scenario";
import { useEffect, useMemo, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { registry } from "@/lib/registry";
import { enqueue } from "@/modules/tasks/queue";
import { useScenario } from "./store";

// Scripted takes: a browser plays the scenario on the real site (Playwright),
// then the montage is built from its scenes. Runs in the background; the
// studio stays free.
export function ScenarioDialog() {
  const open = useScenario((s) => s.dialogOpen);
  const text = useScenario((s) => s.text);
  const values = useScenario((s) => s.values);
  const { set, setText, setValue, setSecrets } = useScenario.getState();
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseScenario(text), [text]);
  const scenario = parsed.ok ? parsed.scenario : null;
  const vars = scenario ? requiredVars(scenario) : [];
  const device = scenario ? registry.get(scenario.device.id) : undefined;
  const scenes = scenario?.steps.filter((s) => s.do === "scene").length ?? 0;

  useEffect(() => {
    if (!scenario) return;
    setSecrets(
      Object.entries(scenario.vars)
        .filter(([, v]) => v.secret)
        .map(([k]) => k),
    );
  }, [scenario, setSecrets]);

  const start = (kind: "simulate" | "record") => {
    if (!scenario) return;
    const resolved = resolveVars(scenario, values);
    if (!resolved.ok) {
      toast.error(`Fill in: ${resolved.missing.join(", ")}`);
      return;
    }
    if (!device) {
      toast.error(`Unknown device "${scenario.device.id}".`);
      return;
    }
    set({ dialogOpen: false });
    // Runs in the background; the task panel shows it and opens the result.
    enqueue({
      kind,
      label: resolved.scenario.name,
      scenario: resolved.scenario,
    });
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => set({ dialogOpen: next })}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Scenario</DialogTitle>
          <DialogDescription>
            A browser plays these steps on the real site, in the background, on
            the chosen device. Each <code>scene</code> becomes a clip with its
            caption; taps get zooms and touch rings. Masked text (test codes) is
            hidden before it is drawn and can be typed back as{" "}
            <code>{"{{code}}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
              >
                Open file…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setText(JSON.stringify(EXAMPLE_SCENARIO, null, 2))
                }
              >
                Insert example
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  void loadFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="h-80 resize-none font-mono text-[11px] leading-relaxed"
            />
            {parsed.ok ? null : (
              <ul className="max-h-24 overflow-y-auto text-xs text-destructive">
                {parsed.errors.slice(0, 6).map((e) => (
                  <li key={e} className="font-mono">
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3 text-xs">
            {scenario ? (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {scenario.name}
                  </span>
                  <span className="text-muted-foreground">
                    {device
                      ? device.name
                      : `Unknown device ${scenario.device.id}`}{" "}
                    · {scenario.film.aspect} · {scenes} scene
                    {scenes === 1 ? "" : "s"}
                  </span>
                </div>
                {vars.map((name) => {
                  const meta = scenario.vars[name];
                  return (
                    <div key={name} className="flex flex-col gap-1">
                      <Label htmlFor={`scenario-var-${name}`}>
                        {meta?.label ?? name}
                      </Label>
                      <Input
                        id={`scenario-var-${name}`}
                        type={meta?.secret ? "password" : "text"}
                        value={values[name] ?? ""}
                        placeholder={meta?.default ?? ""}
                        onChange={(e) => setValue(name, e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  );
                })}
                <ol className="max-h-56 list-decimal overflow-y-auto rounded-md border py-1.5 pr-2 pl-7 text-muted-foreground">
                  {scenario.steps.map((step, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id; the list is read-only.
                      key={i}
                      className={
                        step.do === "scene"
                          ? "truncate pt-1 font-medium text-foreground"
                          : "truncate"
                      }
                    >
                      {stepLabel(step)}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <span className="text-muted-foreground">
                Fix the scenario to see its steps.
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Needs Node.js and Chrome (or a Playwright Chromium).
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => start("simulate")}
              disabled={!scenario || !device}
            >
              Simulate
            </Button>
            <Button
              onClick={() => start("record")}
              disabled={!scenario || !device}
              className="bg-rec text-white hover:bg-rec/90"
            >
              Record scenario
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
