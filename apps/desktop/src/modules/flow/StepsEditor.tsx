import { type Step, stepLabel, stepSchema } from "@goscreen/scenario";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { MenuTrigger } from "@/lib/menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Ready-made steps: the user edits the selector or the text after adding.
export const STEP_TEMPLATES: { label: string; step: Step }[] = [
  {
    label: "Tap a button",
    step: { do: "tap", target: { role: "button", name: "Continue" } },
  },
  {
    label: "Tap a link",
    step: { do: "tap", target: { role: "link", name: "Home" } },
  },
  {
    label: "Type in a field",
    step: { do: "type", target: { css: "input" }, text: "" },
  },
  {
    label: "Type a received code",
    step: { do: "type", text: "{{code}}", delay: 150 },
  },
  { label: "Press a key", step: { do: "press", key: "Enter" } },
  {
    label: "Check a box",
    step: { do: "check", target: { css: "input[type=checkbox]" }, value: true },
  },
  { label: "Scroll down", step: { do: "scroll", by: 400, duration: 1200 } },
  {
    label: "Scroll to an element",
    step: { do: "scroll", to: { text: "Pricing" } },
  },
  { label: "Wait", step: { do: "wait", ms: 1500 } },
  {
    label: "Wait for an element",
    step: { do: "waitFor", target: { text: "Done" } },
  },
  { label: "Wait for an address", step: { do: "waitUrl", match: "/done" } },
  { label: "Open a page", step: { do: "goto", url: "https://" } },
  {
    label: "Remember from the address",
    step: { do: "remember", name: "order", match: "/orders/([\\w-]+)" },
  },
];

/** The steps of one node: a row each, edited as JSON, with menus. */
export function StepsEditor({
  steps,
  onChange,
}: {
  steps: Step[];
  onChange: (steps: Step[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const insert = (at: number, step: Step) => {
    const next = [...steps];
    next.splice(at, 0, structuredClone(step));
    onChange(next);
    setEditing(at);
  };
  const remove = (i: number) => {
    onChange(steps.filter((_, k) => k !== i));
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No step yet.</p>
      ) : null}
      {steps.map((step, i) => (
        <ContextMenu
          // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id; order is the identity
          key={i}
        >
          <MenuTrigger>
            <div
              className={cn(
                "flex flex-col gap-1 rounded-md border px-2 py-1.5",
                editing === i && "border-white/30",
              )}
            >
              <div className="flex items-center gap-1">
                <span className="w-5 shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  onClick={() => setEditing(editing === i ? null : i)}
                  title="Edit"
                >
                  {stepLabel(step)}
                </button>
                <IconBtn
                  label="Move up"
                  icon={ArrowUp01Icon}
                  onClick={() => move(i, -1)}
                />
                <IconBtn
                  label="Move down"
                  icon={ArrowDown01Icon}
                  onClick={() => move(i, 1)}
                />
                <IconBtn
                  label="Delete"
                  icon={Delete02Icon}
                  onClick={() => remove(i)}
                />
              </div>
              {editing === i ? (
                <StepJson
                  step={step}
                  onChange={(s) =>
                    onChange(steps.map((x, k) => (k === i ? s : x)))
                  }
                />
              ) : null}
            </div>
          </MenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setEditing(i)}>
              Edit
            </ContextMenuItem>
            <ContextMenuItem onClick={() => insert(i + 1, step)}>
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => insert(i, { do: "wait", ms: 1000 })}
            >
              Insert a wait before
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => insert(i + 1, { do: "wait", ms: 1000 })}
            >
              Insert a wait after
            </ContextMenuItem>
            <ContextMenuItem onClick={() => move(i, -1)}>
              Move up
            </ContextMenuItem>
            <ContextMenuItem onClick={() => move(i, 1)}>
              Move down
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => remove(i)}>
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" className="mt-1 self-start">
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Add a step
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {STEP_TEMPLATES.map((t) => (
            <DropdownMenuItem
              key={t.label}
              onSelect={() => insert(steps.length, t.step)}
            >
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StepJson({
  step,
  onChange,
}: {
  step: Step;
  onChange: (step: Step) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(step, null, 1));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify(step, null, 1));
  }, [step]);
  const commit = () => {
    try {
      const parsed = stepSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setError(`${issue.path.join(".") || "step"}: ${issue.message}`);
        return;
      }
      setError(null);
      onChange(parsed.data);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        rows={Math.min(10, text.split("\n").length + 1)}
        className="min-h-0 resize-y font-mono text-[11px] leading-snug"
      />
      {error ? (
        <p className="font-mono text-[10px] text-destructive">{error}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Saved when you leave the field. Targets: css, text, role + name,
          label, placeholder, testId; refine with hasText, nth (-1 = last),
          frame.
        </p>
      )}
    </div>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof Add01Icon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={12} />
    </button>
  );
}
