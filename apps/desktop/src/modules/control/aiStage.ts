import type { Flow } from "@goscreen/scenario";
import { router } from "@/lib/router";
import { useSession } from "@/modules/editor/session";
import { useFlowDoc } from "@/modules/flow/store";
import { openPlace } from "@/modules/tabs/tabs";
import { aiClick, aiPoint, aiRest, useAiWatch } from "./aiCursor";
import type { Answer } from "./registry";

// The staging of an AI's commands for the person watching: the place opens
// in its tab, the AI's cursor goes to what changes, then shows the result.

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(100);
  return ok();
}

// One staging at a time, in command order: the cursor never shows a command
// while the previous one is still being shown.
let chain: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** What the person sees before a command runs; returns what to compare after. */
export function stageBefore(
  command: string,
  input: Input,
  title: string,
): Promise<{ flow: Flow | null }> {
  return inTurn(() => before(command, input, title));
}

/** After the command: point at what it made or changed. */
export function stageAfter(
  command: string,
  answer: Answer,
  was: { flow: Flow | null },
): Promise<void> {
  return inTurn(() => after(command, answer, was));
}

async function before(
  command: string,
  input: Input,
  title: string,
): Promise<{ flow: Flow | null }> {
  const seen = { flow: null as Flow | null };
  if (!useAiWatch.getState().follow) return seen;
  const video = str(input.video);
  const project = str(input.project);
  const vsl = str(input.vsl);

  // Its place, in its tab (the person's own tabs stay as they are).
  if ((command.startsWith("edit.") || command === "export.video") && video) {
    openPlace({ to: "/editor", search: { video } });
    await until(() => useSession.getState().videoPath === video, 8000);
    await sleep(300);
  } else if (
    (command === "vsl.save" || command === "vsl.setValues") &&
    project &&
    vsl
  ) {
    openPlace({ to: "/flow", search: { project, vsl } });
    await until(() => {
      const s = router.state.location.search as { vsl?: string };
      return s.vsl === vsl && useFlowDoc.getState().flow !== null;
    }, 6000);
    await sleep(400);
    seen.flow = useFlowDoc.getState().flow;
  }

  const item = str(input.overlay);
  const targets: string[] =
    command === "edit.animate" || command === "edit.updateBlock"
      ? [`[data-ai-item="${item}"]`, '[data-ai="timeline"]']
      : command === "edit.setFilm"
        ? ['[data-ai="inspector"]']
        : command === "edit.addBlock"
          ? ['[data-ai="program"]']
          : command.startsWith("edit.")
            ? ['[data-ai="timeline"]']
            : command.startsWith("export.")
              ? ['[data-ai="export"]']
              : command.startsWith("vsl.")
                ? ['[data-ai="flow"]', '[data-ai="projects"]']
                : command.startsWith("tasks.") || command === "site.inspect"
                  ? ['[data-ai="tasks"]', '[data-ai="tabs"]']
                  : command.startsWith("projects.")
                    ? ['[data-ai="projects"]', '[data-ai="tabs"]']
                    : ['[data-ai="tabs"]'];
  if (await aiPoint(targets, `${title}…`)) await aiClick();
  return seen;
}

async function after(
  command: string,
  answer: Answer,
  was: { flow: Flow | null },
) {
  if (!useAiWatch.getState().follow) return;
  if (!answer.ok) {
    aiRest(`Stopped: ${answer.error}`);
    return;
  }
  const result = (answer.result ?? {}) as Input;
  const made = str(result.overlay) ?? str(result.item);
  if (made) {
    const at = `[data-ai-item="${made}"]`;
    await until(() => document.querySelector(at) !== null, 2000);
    await aiPoint(at, "Here it is");
  } else if (command === "edit.setFilm") {
    await aiPoint('[data-ai="program"]', "Film settings applied");
  } else if (command === "vsl.save" && was.flow) {
    await showFlowChanges(was.flow);
  }
  aiRest();
}

/** Each node the AI added or changed, one after the other. */
async function showFlowChanges(old: Flow) {
  // The saved file reaches the open flow a moment later.
  await until(() => useFlowDoc.getState().flow !== old, 3000);
  await sleep(150);
  const next = useFlowDoc.getState().flow;
  if (!next) return;
  const was = new Map(old.nodes.map((n) => [n.id, JSON.stringify(n)]));
  const changed = next.nodes
    .filter((n) => was.get(n.id) !== JSON.stringify(n))
    .slice(0, 6);
  for (const n of changed) {
    const label = `${was.has(n.id) ? "Changed" : "Added"} “${n.caption || n.id}”`;
    if (await aiPoint(`.react-flow__node[data-id="${n.id}"]`, label)) {
      await aiClick();
      await sleep(350);
    }
  }
}
