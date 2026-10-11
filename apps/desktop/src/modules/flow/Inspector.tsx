import {
  compileFlow,
  type Flow,
  type FlowNode,
  type FlowStart,
  flowIssues,
  flowPaths,
  pathLabel,
  requiredVars,
  START,
} from "@goscreen/scenario";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { registry } from "@/lib/registry";
import { record, setValue, simulate, valuesKey, valuesOf } from "./runs";
import { StepsEditor } from "./StepsEditor";
import { flowActions, useFlowDoc } from "./store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Inspector({ project, vsl }: { project: string; vsl: string }) {
  const flow = useFlowDoc((s) => s.flow);
  const selected = useFlowDoc((s) => s.selected);
  if (!flow) return null;
  const node = flow.nodes.find((n) => n.id === selected);
  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l">
      {selected === START ? (
        <StartPanel flow={flow} />
      ) : node ? (
        <NodePanel key={node.id} node={node} />
      ) : (
        <JourneysPanel flow={flow} project={project} vsl={vsl} />
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b p-4">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Text input that writes back on blur (one undo-free change per edit). */
function Text({
  value,
  onCommit,
  mono,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      spellCheck={false}
      className={mono ? "h-8 font-mono text-xs" : "h-8 text-xs"}
    />
  );
}

function NodePanel({ node }: { node: FlowNode }) {
  const patch = (p: Partial<FlowNode>) => flowActions.patchNode(node.id, p);
  return (
    <>
      <Section title="Node">
        <Field label="Kind">
          <Select
            value={node.kind}
            onValueChange={(kind) => patch({ kind: kind as FlowNode["kind"] })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scene">
                Scene (filmed, with a caption)
              </SelectItem>
              <SelectItem value="offcamera">
                Off camera (played, cut out)
              </SelectItem>
              <SelectItem value="session">Session (another account)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {node.kind === "session" ? (
          <Field label="Account name">
            <Text
              value={node.session ?? ""}
              placeholder="seller"
              onCommit={(session) =>
                patch({ session: session.replace(/[^\w-]/g, "") || undefined })
              }
            />
          </Field>
        ) : (
          <Field label={node.kind === "scene" ? "Caption" : "Note"}>
            <Text
              value={node.caption}
              onCommit={(caption) => patch({ caption })}
            />
          </Field>
        )}
      </Section>
      <Section title="On the site">
        <Button
          size="sm"
          onClick={() => useFlowDoc.getState().setLive(node.id)}
        >
          Record actions on the site
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Opens the page as it is after the scenes before this one, then adds
          each click, typing and scroll you make as a step. No need to read the
          site's code.
        </p>
      </Section>
      <Section title={`Steps (${node.steps.length})`}>
        <StepsEditor
          steps={node.steps}
          onChange={(steps) => flowActions.setSteps(node.id, steps)}
        />
      </Section>
    </>
  );
}

function StartPanel({ flow }: { flow: Flow }) {
  const start = flow.start;
  const edit = (patch: Partial<FlowStart>) =>
    useFlowDoc
      .getState()
      .update((f) => ({ ...f, start: { ...f.start, ...patch } }));
  const film = (patch: Partial<FlowStart["film"]>) =>
    edit({ film: { ...start.film, ...patch } });
  const card = (
    key: "intro" | "outro",
    patch: { title?: string; subtitle?: string },
  ) => {
    const current = start.film[key] ?? { title: "", subtitle: "", duration: 3 };
    const next = { ...current, ...patch };
    film({ [key]: next.title.trim() ? next : undefined });
  };
  const [vars, setVars] = useState(() => JSON.stringify(start.vars, null, 1));
  useEffect(() => setVars(JSON.stringify(start.vars, null, 1)), [start.vars]);

  return (
    <>
      <Section title="Start">
        <Field label="VSL name">
          <Text
            value={flow.name}
            onCommit={(name) =>
              name.trim() &&
              useFlowDoc.getState().update((f) => ({ ...f, name: name.trim() }))
            }
          />
        </Field>
        <Field label="Start page">
          <Text
            mono
            value={start.url}
            onCommit={(url) =>
              /^https?:\/\//i.test(url)
                ? edit({ url })
                : toast.error("Only http(s) addresses.")
            }
          />
        </Field>
        <Field label="Device">
          <Select
            value={start.device.id}
            onValueChange={(id) => edit({ device: { id } })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {registry.list().map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Language">
            <Text
              value={start.locale}
              onCommit={(locale) => edit({ locale })}
            />
          </Field>
          <Field label="Time zone">
            <Text
              value={start.timezone ?? ""}
              placeholder="Africa/Porto-Novo"
              onCommit={(tz) => edit({ timezone: tz.trim() || undefined })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Film">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Format">
            <Select
              value={start.film.aspect}
              onValueChange={(aspect) =>
                film({ aspect: aspect as FlowStart["film"]["aspect"] })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["9:16", "16:9", "1:1", "4:5"].map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Captions">
            <Select
              value={start.film.captions}
              onValueChange={(captions) =>
                film({ captions: captions as FlowStart["film"]["captions"] })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["background", "ink", "accent"] as const).map((key) => (
            <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
              <input
                type="color"
                value={start.film[key]}
                onChange={(e) => film({ [key]: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border bg-transparent"
              />
            </Field>
          ))}
        </div>
        <Field label="Font">
          <Text value={start.film.font} onCommit={(font) => film({ font })} />
        </Field>
        <Field label="Opening card">
          <Text
            value={start.film.intro?.title ?? ""}
            placeholder="Title (empty: no card)"
            onCommit={(title) => card("intro", { title })}
          />
          <Text
            value={start.film.intro?.subtitle ?? ""}
            placeholder="Subtitle"
            onCommit={(subtitle) => card("intro", { subtitle })}
          />
        </Field>
        <Field label="Closing card">
          <Text
            value={start.film.outro?.title ?? ""}
            placeholder="Title (empty: no card)"
            onCommit={(title) => card("outro", { title })}
          />
          <Text
            value={start.film.outro?.subtitle ?? ""}
            placeholder="Subtitle"
            onCommit={(subtitle) => card("outro", { subtitle })}
          />
        </Field>
      </Section>

      <Section title="Values and masks">
        <Field label="Values asked before a run ({{name}})">
          <Textarea
            value={vars}
            onChange={(e) => setVars(e.target.value)}
            onBlur={() => {
              try {
                edit({ vars: JSON.parse(vars) });
              } catch {
                toast.error("The values are not valid JSON.");
              }
            }}
            spellCheck={false}
            rows={5}
            className="font-mono text-[11px]"
          />
        </Field>
        <Field label="Masks: text hidden before it is drawn (one pattern per line)">
          <Textarea
            defaultValue={start.mask.join("\n")}
            onBlur={(e) =>
              edit({
                mask: e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            spellCheck={false}
            rows={3}
            className="font-mono text-[11px]"
          />
        </Field>
      </Section>
    </>
  );
}

function JourneysPanel({
  flow,
  project,
  vsl,
}: {
  flow: Flow;
  project: string;
  vsl: string;
}) {
  const paths = useMemo(() => flowPaths(flow), [flow]);
  const issues = useMemo(() => flowIssues(flow), [flow]);
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(paths.map((_, i) => i)),
  );
  useEffect(() => setPicked(new Set(paths.map((_, i) => i))), [paths]);
  const key = valuesKey(project, vsl);
  const [values, setValues] = useState(() => valuesOf(key));
  const names = useMemo(
    () => requiredVars(compileFlow(flow, paths).scenario),
    [flow, paths],
  );
  const chosen = paths.filter((_, i) => picked.has(i));
  const target = { project, vsl };
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast.error(message(e));
    }
  };

  return (
    <>
      <Section title={`Journeys (${paths.length})`}>
        {paths.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Link a scene to Start. Each way from Start to a last node is a
            journey; a branch is a variant.
          </p>
        ) : (
          paths.map((p, i) => (
            <label
              // biome-ignore lint/suspicious/noArrayIndexKey: journeys are recomputed from the flow
              key={i}
              htmlFor={`journey-${i}`}
              className="flex cursor-pointer items-start gap-2 text-xs"
            >
              <Checkbox
                id={`journey-${i}`}
                checked={picked.has(i)}
                onCheckedChange={(v) =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (v === true) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span>
                <span className="font-medium">Journey {i + 1}</span>
                <span className="block text-muted-foreground">
                  {pathLabel(flow, p)}
                </span>
              </span>
            </label>
          ))
        )}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={chosen.length === 0}
            onClick={() => run(() => simulate(flow, target, chosen))}
          >
            Simulate
          </Button>
          <Button
            size="sm"
            disabled={chosen.length === 0}
            className="bg-rec text-white hover:bg-rec/90"
            onClick={() => run(() => record(flow, target, chosen))}
          >
            Record the VSL
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          A simulation plays each journey without filming and colours the nodes.
          Recording plays the chosen journeys back to back into one video, then
          builds its montage. Both run in the background.
        </p>
      </Section>

      {names.length > 0 ? (
        <Section title="Values">
          {names.map((name) => {
            const meta = flow.start.vars[name];
            return (
              <Field key={name} label={meta?.label ?? name}>
                <Input
                  type={meta?.secret ? "password" : "text"}
                  value={values[name] ?? ""}
                  placeholder={meta?.default ?? ""}
                  onChange={(e) => {
                    setValue(flow, key, name, e.target.value);
                    setValues((v) => ({ ...v, [name]: e.target.value }));
                  }}
                  className="h-8 text-xs"
                />
              </Field>
            );
          })}
        </Section>
      ) : null}

      {issues.length > 0 ? (
        <Section title={`To check (${issues.length})`}>
          {issues.map((i) => (
            <button
              key={`${i.node}-${i.message}`}
              type="button"
              className="text-left text-xs text-amber-300 hover:underline"
              onClick={() => useFlowDoc.getState().select(i.node)}
            >
              {i.node}: {i.message}
            </button>
          ))}
        </Section>
      ) : null}
    </>
  );
}
