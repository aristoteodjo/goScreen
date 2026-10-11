import {
  type EditState,
  parseEditState,
  parseRecordingFile,
} from "@goscreen/render-engine";
import {
  buildScenarioEdit,
  compileFlow,
  type Flow,
  filmSchema,
  flowFromScenario,
  flowIssues,
  flowPaths,
  flowSchema,
  newFlow,
  parseFlow,
  pathLabel,
  pathTo,
  resolveVars,
  scenarioSchema,
  stepSchema,
} from "@goscreen/scenario";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { z } from "zod";
import { ipc, projectsIpc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { registry } from "@/lib/registry";
import { router } from "@/lib/router";
import { exportVideo } from "@/modules/editor/exportVideo";
import {
  assetUrl,
  currentTimeline,
  player,
  useSession,
} from "@/modules/editor/session";
import { useEdit } from "@/modules/editor/store";
import { useFlowDoc } from "@/modules/flow/store";
import {
  record,
  setValue,
  simulate,
  valuesKey,
  valuesOf,
} from "@/modules/flow/runs";
import { cancelTask, deviceFor } from "@/modules/tasks/queue";
import { isFinished, type Task, useTasks } from "@/modules/tasks/store";
import { catalog, defineCommand } from "./registry";

// The commands an AI can run. Each one is what a button of the studio does,
// on the same data, so a person and an agent can take turns on a project.

const id = z.string().min(1).describe("An id as returned by a list command");
const project = id.describe("Project id (projects.list)");
const vsl = id.describe("VSL id (vsl.list)");
const video = z
  .string()
  .min(1)
  .describe("Absolute path of a video (projects.videos)");

const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadFlow(projectId: string, vslId: string): Promise<Flow> {
  const parsed = parseFlow(await projectsIpc.loadVsl(projectId, vslId));
  if (!parsed.ok) throw new Error(`The VSL is invalid: ${parsed.errors[0]}`);
  return parsed.flow;
}

/** Saves a flow; if a person has it open, their screen follows. */
async function saveFlow(projectId: string, vslId: string, flow: Flow) {
  await projectsIpc.saveVsl(projectId, vslId, flow);
  const here = router.state.location;
  const search = here.search as { project?: string; vsl?: string };
  if (
    here.pathname === "/flow" &&
    search.project === projectId &&
    search.vsl === vslId
  )
    useFlowDoc.getState().load(flow);
  void refresh();
}

function journeys(flow: Flow) {
  return flowPaths(flow).map((path, index) => ({
    index,
    label: pathLabel(flow, path),
    nodes: path,
  }));
}

const taskView = (t: Task) => ({
  id: t.id,
  kind: t.kind,
  label: t.label,
  status: t.status,
  step: t.index,
  total: t.total,
  scenes: t.scenes.map((s) => s.caption),
  video: t.video,
  error: t.error,
  failedNode: t.failedNode,
});

const pickPaths = (flow: Flow, picked?: number[]) => {
  const all = flowPaths(flow);
  return picked?.length ? picked.map((i) => all[i]).filter(Boolean) : all;
};

export function registerCommands() {
  defineCommand({
    name: "control.catalog",
    title: "List commands",
    description: "Every command with its input JSON Schema.",
    input: z.object({}),
    run: async () => catalog(),
  });

  defineCommand({
    name: "help.formats",
    title: "Read the formats",
    description:
      "How flows, scenes, steps, targets and films are written. Read once before writing a VSL.",
    input: z.object({}),
    run: async () => ({
      flow: z.toJSONSchema(flowSchema, { io: "input", unrepresentable: "any" }),
      step: z.toJSONSchema(stepSchema, { io: "input", unrepresentable: "any" }),
      guide: [
        "A VSL is a flow: start (site, device, film, vars, masks) then nodes linked by edges.",
        "Node kinds: scene (filmed, its caption shows on the video), offcamera (played, cut out), session (switch to another account).",
        "Every path from start to a last node is a journey; a branch is a variant.",
        "Targets: one of css, text, role (+ name), label, placeholder, testId; refine with hasText, nth (-1 = last), frame (iframe css). Prefer the targets site.inspect returns.",
        "{{name}} in texts and URLs is a value asked to the person (start.vars) or kept by a remember step; {{code}} types the last code shown in a masked block.",
        "Typical work: site.inspect -> vsl.create -> vsl.save with scenes -> tasks.simulate -> tasks.wait -> fix -> tasks.record -> tasks.wait -> edit.get/edit.save -> export.video.",
      ],
    }),
  });

  defineCommand({
    name: "app.status",
    title: "Read the app state",
    description: "Where the studio is, and what runs in the background.",
    input: z.object({}),
    run: async () => ({
      location: router.state.location.href,
      tasks: useTasks.getState().tasks.slice(0, 10).map(taskView),
    }),
  });

  defineCommand({
    name: "app.show",
    title: "Show a screen",
    description:
      "Puts a screen in front of the person: home, a project, a VSL flow, a video in the editor, or the studio.",
    input: z.object({
      view: z.enum(["home", "project", "flow", "editor", "studio"]),
      project: project.optional(),
      vsl: vsl.optional(),
      video: video.optional(),
    }),
    run: async (i) => {
      if (i.view === "home") await router.navigate({ to: "/" });
      else if (i.view === "studio") await router.navigate({ to: "/studio" });
      else if (i.view === "project" && i.project)
        await router.navigate({
          to: "/projects/$project",
          params: { project: i.project },
        });
      else if (i.view === "flow" && i.project && i.vsl)
        await router.navigate({
          to: "/flow",
          search: { project: i.project, vsl: i.vsl },
        });
      else if (i.view === "editor" && i.video)
        await router.navigate({ to: "/editor", search: { video: i.video } });
      else throw new Error("Give the ids this view needs.");
      return { location: router.state.location.href };
    },
  });

  defineCommand({
    name: "devices.list",
    title: "List devices",
    description: "Devices a VSL can be filmed on (id, kind, CSS viewport).",
    input: z.object({
      category: z.enum(["phone", "tablet", "laptop", "desktop"]).optional(),
    }),
    run: async (i) =>
      registry
        .list()
        .filter((d) => !i.category || d.category === i.category)
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          viewport: d.viewport,
        })),
  });

  // Projects
  defineCommand({
    name: "projects.list",
    title: "List projects",
    description: "Projects (folders) with their number of VSLs and videos.",
    input: z.object({}),
    run: () => projectsIpc.list(),
  });
  defineCommand({
    name: "projects.create",
    title: "Create a project",
    description: "Creates a project folder; returns its id.",
    input: z.object({ name: z.string().min(1).max(80) }),
    run: async (i) => {
      const created = await projectsIpc.create(i.name);
      void refresh();
      return { project: created };
    },
  });
  defineCommand({
    name: "projects.rename",
    title: "Rename a project",
    description: "Changes the name only; the id stays.",
    input: z.object({ project, name: z.string().min(1).max(80) }),
    run: async (i) => {
      await projectsIpc.rename(i.project, i.name);
      void refresh();
    },
  });
  defineCommand({
    name: "projects.duplicate",
    title: "Duplicate a project",
    description: "Copies the VSLs (not the videos) into a new project.",
    input: z.object({ project }),
    run: async (i) => {
      const copy = await projectsIpc.duplicate(i.project);
      void refresh();
      return { project: copy };
    },
  });
  defineCommand({
    name: "projects.delete",
    title: "Delete a project",
    description:
      "Moves the whole folder (VSLs and videos) to the system trash.",
    destructive: true,
    input: z.object({ project }),
    run: async (i) => {
      await projectsIpc.remove(i.project);
      void refresh();
    },
  });
  defineCommand({
    name: "projects.videos",
    title: "List a project's videos",
    description: "Recorded takes and exports of a project, newest first.",
    input: z.object({ project }),
    run: (i) => projectsIpc.videos(i.project),
  });

  // VSLs
  defineCommand({
    name: "vsl.list",
    title: "List VSLs",
    description: "The VSL flows of a project.",
    input: z.object({ project }),
    run: (i) => projectsIpc.vsls(i.project),
  });
  defineCommand({
    name: "vsl.get",
    title: "Read a VSL",
    description:
      "The whole flow, its journeys (paths from start) and what to fix.",
    input: z.object({ project, vsl }),
    run: async (i) => {
      const flow = await loadFlow(i.project, i.vsl);
      return { flow, journeys: journeys(flow), issues: flowIssues(flow) };
    },
  });
  defineCommand({
    name: "vsl.create",
    title: "Create a VSL",
    description:
      "Creates a VSL in a project: from a full flow, or empty from a start URL and a device.",
    input: z.object({
      project,
      name: z.string().min(1).max(80),
      url: z.string().url().optional(),
      device: z.string().default("galaxy-s25"),
      flow: z.unknown().optional(),
    }),
    run: async (i) => {
      let flow: Flow;
      if (i.flow !== undefined) {
        const parsed = parseFlow(i.flow);
        if (!parsed.ok) throw new Error(parsed.errors.slice(0, 5).join("; "));
        flow = parsed.flow;
      } else if (i.url) flow = newFlow(i.name, i.url, i.device);
      else throw new Error("Give a flow or a start url.");
      const created = await projectsIpc.createVsl(i.project, i.name, flow);
      void refresh();
      return { vsl: created, issues: flowIssues(flow) };
    },
  });
  defineCommand({
    name: "vsl.save",
    title: "Save a VSL",
    description:
      "Replaces the flow (validated). If the person has it open, their screen shows the change.",
    input: z.object({ project, vsl, flow: z.unknown() }),
    run: async (i) => {
      const parsed = parseFlow(i.flow);
      if (!parsed.ok) throw new Error(parsed.errors.slice(0, 5).join("; "));
      await saveFlow(i.project, i.vsl, parsed.flow);
      return {
        journeys: journeys(parsed.flow),
        issues: flowIssues(parsed.flow),
      };
    },
  });
  defineCommand({
    name: "vsl.importScenario",
    title: "Import a scenario",
    description: "Turns a scenario (linear steps) into a VSL flow.",
    input: z.object({ project, scenario: z.unknown() }),
    run: async (i) => {
      const parsed = scenarioSchema.safeParse(i.scenario);
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid scenario");
      const flow = flowFromScenario(parsed.data);
      const created = await projectsIpc.createVsl(i.project, flow.name, flow);
      void refresh();
      return { vsl: created };
    },
  });
  defineCommand({
    name: "vsl.rename",
    title: "Rename a VSL",
    description: "Changes the VSL name.",
    input: z.object({ project, vsl, name: z.string().min(1).max(80) }),
    run: async (i) => {
      await projectsIpc.renameVsl(i.project, i.vsl, i.name);
      void refresh();
    },
  });
  defineCommand({
    name: "vsl.duplicate",
    title: "Duplicate a VSL",
    description: "Copies a VSL in the same project.",
    input: z.object({ project, vsl }),
    run: async (i) => {
      const copy = await projectsIpc.duplicateVsl(i.project, i.vsl);
      void refresh();
      return { vsl: copy };
    },
  });
  defineCommand({
    name: "vsl.delete",
    title: "Delete a VSL",
    description: "Moves the flow to the system trash; its videos stay.",
    destructive: true,
    input: z.object({ project, vsl }),
    run: async (i) => {
      await projectsIpc.removeVsl(i.project, i.vsl);
      void refresh();
    },
  });
  defineCommand({
    name: "vsl.setValues",
    title: "Set a VSL's values",
    description:
      "Fills the {{values}} a VSL asks for (phone numbers, names) on this machine. Secret ones stay in memory only.",
    input: z.object({
      project,
      vsl,
      values: z.record(z.string(), z.string()),
    }),
    run: async (i) => {
      const flow = await loadFlow(i.project, i.vsl);
      const key = valuesKey(i.project, i.vsl);
      for (const [name, value] of Object.entries(i.values))
        setValue(flow, key, name, value);
    },
  });

  // Looking at a site
  defineCommand({
    name: "site.inspect",
    title: "Inspect a page",
    description:
      "Opens a page in the emulated device and describes it: title, headings, visible text, iframes and every element a visitor can act on with a checked target ready for a step. Either a url, or a VSL node: the page as it is after the journey up to that node.",
    input: z.object({
      url: z.string().url().optional(),
      device: z.string().default("galaxy-s25"),
      project: project.optional(),
      vsl: vsl.optional(),
      node: z.string().optional().describe("Node id: inspect after it"),
      screenshot: z
        .boolean()
        .default(false)
        .describe("Also return a JPEG (base64) of the screen"),
    }),
    run: async (i) => {
      let scenario: ReturnType<typeof compileFlow>["scenario"];
      if (i.project && i.vsl && i.node) {
        const flow = await loadFlow(i.project, i.vsl);
        const path = pathTo(flow, i.node);
        if (!path) throw new Error("This node is not linked to start.");
        const r = resolveVars(
          compileFlow(flow, [path]).scenario,
          valuesOf(valuesKey(i.project, i.vsl)),
        );
        if (!r.ok) throw new Error(`Missing values: ${r.missing.join(", ")}`);
        scenario = r.scenario;
      } else if (i.url) {
        scenario = scenarioSchema.parse({
          version: 1,
          name: "inspect",
          url: i.url,
          device: { id: i.device },
          steps: [{ do: "wait", ms: 300 }],
        });
      } else throw new Error("Give a url, or a project, vsl and node.");
      const outcome = await ipc.siteInspect({
        scenario,
        device: deviceFor(scenario),
      });
      if (outcome.status !== "inspected")
        throw new Error(
          outcome.status === "failed" ? outcome.message : "No description.",
        );
      const { screenshot, ...page } = outcome.page as Record<string, unknown>;
      return i.screenshot ? { ...page, screenshot } : page;
    },
  });

  // Background work
  defineCommand({
    name: "tasks.simulate",
    title: "Simulate journeys",
    description:
      "Plays journeys without filming (one background task each) and colours the flow. Real actions happen on the site.",
    destructive: true,
    input: z.object({
      project,
      vsl,
      journeys: z.array(z.number().int().min(0)).optional(),
    }),
    run: async (i) => {
      const flow = await loadFlow(i.project, i.vsl);
      const before = new Set(useTasks.getState().tasks.map((t) => t.id));
      simulate(
        flow,
        { project: i.project, vsl: i.vsl },
        pickPaths(flow, i.journeys),
      );
      return {
        tasks: useTasks
          .getState()
          .tasks.filter((t) => !before.has(t.id))
          .map((t) => t.id),
      };
    },
  });
  defineCommand({
    name: "tasks.record",
    title: "Record the VSL",
    description:
      "Plays the chosen journeys back to back into one video and builds its montage (background task).",
    destructive: true,
    input: z.object({
      project,
      vsl,
      journeys: z.array(z.number().int().min(0)).optional(),
    }),
    run: async (i) => {
      const flow = await loadFlow(i.project, i.vsl);
      const before = new Set(useTasks.getState().tasks.map((t) => t.id));
      record(
        flow,
        { project: i.project, vsl: i.vsl },
        pickPaths(flow, i.journeys),
      );
      const task = useTasks.getState().tasks.find((t) => !before.has(t.id));
      return { task: task?.id ?? null };
    },
  });
  defineCommand({
    name: "tasks.list",
    title: "List tasks",
    description: "Background simulations and recordings, newest first.",
    input: z.object({}),
    run: async () => useTasks.getState().tasks.map(taskView),
  });
  defineCommand({
    name: "tasks.wait",
    title: "Wait for a task",
    description:
      "Waits until a task ends (or the timeout) and returns it: status, failing step and node, video.",
    input: z.object({
      task: id,
      timeoutS: z.number().int().min(1).max(1800).default(600),
    }),
    run: async (i) => {
      const until = Date.now() + i.timeoutS * 1000;
      for (;;) {
        const t = useTasks.getState().tasks.find((x) => x.id === i.task);
        if (!t) throw new Error("No such task.");
        if (isFinished(t) || Date.now() > until) return taskView(t);
        await sleep(500);
      }
    },
  });
  defineCommand({
    name: "tasks.cancel",
    title: "Stop a task",
    description: "Stops a running task or takes a waiting one out of the line.",
    input: z.object({ task: id }),
    run: (i) => cancelTask(i.task),
  });

  // Montage
  defineCommand({
    name: "edit.get",
    title: "Read a montage",
    description:
      "The edit of a video (clips, overlays, zooms, film settings) and the take's scenes.",
    input: z.object({ video }),
    run: async (i) => {
      const opened = await ipc.recordingOpen(i.video);
      const take = parseRecordingFile(opened.interactions);
      return {
        edit: parseEditState(opened.edit),
        scenes: take.chapters,
        taps: take.pointers.filter((p) => p.kind === "down").length,
      };
    },
  });
  defineCommand({
    name: "edit.save",
    title: "Change a montage",
    description:
      "Replaces the edit (validated field by field). If the video is open, the person sees it at once and can undo it.",
    input: z.object({ video, edit: z.unknown() }),
    run: async (i) => {
      const edit = parseEditState(i.edit);
      if (!edit) throw new Error("This edit cannot be read.");
      await applyEdit(i.video, edit);
      return { clips: edit.clips.length, overlays: edit.overlays.length };
    },
  });
  defineCommand({
    name: "edit.rebuild",
    title: "Rebuild a montage from its scenes",
    description:
      "Rebuilds the edit of a scenario take: cards, one clip and caption per scene, zooms. Film settings optional.",
    input: z.object({
      video,
      film: z.unknown().optional(),
      locale: z.string().default("en-US"),
    }),
    run: async (i) => {
      const film = filmSchema.parse(i.film ?? {});
      const opened = await ipc.recordingOpen(i.video);
      const take = parseRecordingFile(opened.interactions);
      const duration = Math.max(0, ...take.chapters.map((c) => c.end));
      const edit = buildScenarioEdit(
        {
          chapters: take.chapters,
          pointers: take.pointers,
          layers: take.layers,
          duration,
        },
        film,
        i.locale,
      );
      await applyEdit(i.video, edit);
      return { clips: edit.clips.length };
    },
  });
  defineCommand({
    name: "export.video",
    title: "Export a video",
    description:
      "Opens the video in the editor and exports its montage to MP4; returns the file. The window comes to the front and the person sees the progress. One export at a time.",
    input: z.object({
      video,
      resolution: z.enum(["720", "1080", "2160"]).default("1080"),
      fps: z.union([z.literal(30), z.literal(60)]).default(30),
    }),
    run: async (i) => {
      if (exporting)
        throw new Error(
          "An export is already running (export.cancel to stop it).",
        );
      // The editor draws every frame: it must not be throttled behind
      // other windows.
      const win = getCurrentWindow();
      await win.unminimize().catch(() => {});
      await win.show().catch(() => {});
      await win.setFocus().catch(() => {});
      await router.navigate({ to: "/editor", search: { video: i.video } });
      const until = Date.now() + 30_000;
      while (
        !(useSession.getState().videoPath === i.video && currentTimeline())
      ) {
        if (Date.now() > until) throw new Error("The video did not load.");
        await sleep(200);
      }
      await sleep(500);
      const s = useSession.getState();
      const timeline = currentTimeline();
      if (!s.videoUrl || !timeline) throw new Error("The video did not load.");
      player.pause();
      exporting = new AbortController();
      const progress = toast.loading("The AI is exporting the video… 0%");
      let shown = 0;
      // macOS stops loading media in a window hidden behind others: if
      // nothing moves for a while, say so instead of waiting forever.
      let lastMove = Date.now();
      let watchdog: ReturnType<typeof setInterval> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        watchdog = setInterval(() => {
          if (Date.now() - lastMove < STALL_MS) return;
          exporting?.abort();
          void ipc.exportCancel().catch(() => {});
          reject(
            new Error(
              "The export does not move: bring the goScreen window to the front (not minimised, not hidden), then run export.video again.",
            ),
          );
        }, 1000);
      });
      try {
        const path = await Promise.race([
          stalled,
          exportVideo({
            edit: useEdit.getState().edit,
            timeline,
            videoUrl: s.videoUrl,
            videoPath: s.videoPath,
            cameraUrl: s.cameraUrl,
            mediaOffset: s.mediaOffset,
            hasMic: s.micUrl !== null,
            assetUrl: (a) => assetUrl(useEdit.getState().edit, a),
            name: s.name,
            longSide: { "720": 1280, "1080": 1920, "2160": 3840 }[i.resolution],
            fps: i.fps,
            signal: exporting.signal,
            onProgress: (done) => {
              lastMove = Date.now();
              const pct = Math.round(done * 100);
              if (pct === shown) return;
              shown = pct;
              toast.loading(`The AI is exporting the video… ${pct}%`, {
                id: progress,
              });
            },
          }),
        ]);
        toast.success("Video exported by the AI", { id: progress });
        return { file: path };
      } catch (e) {
        toast.error("Export stopped", {
          id: progress,
          description: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        clearInterval(watchdog);
        exporting = null;
      }
    },
  });
  defineCommand({
    name: "export.cancel",
    title: "Stop the export",
    description: "Stops the export started by export.video.",
    input: z.object({}),
    run: async () => {
      if (!exporting) return { stopped: false };
      exporting.abort();
      // A stuck export (media never loaded) must not block the next one.
      exporting = null;
      await ipc.exportCancel().catch(() => {});
      return { stopped: true };
    },
  });
}

let exporting: AbortController | null = null;
const STALL_MS = 30_000;

async function applyEdit(videoPath: string, edit: EditState) {
  const open = useSession.getState().videoPath === videoPath;
  if (open) useEdit.getState().change(() => edit, "ai");
  else await ipc.editSave(videoPath, edit);
}
