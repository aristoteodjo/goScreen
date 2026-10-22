import { captionLook } from "@/modules/editor/sound";
import { BLOCKS } from "@goscreen/blocks";
import {
  ANIMATION_PRESETS,
  type AudioClip,
  applyPreset,
  clearAnimation,
  type EditState,
  isBlank,
  MIC_ASSET,
  type Overlay,
  parseEditReport,
  parseEditState,
  parseRecordingFile,
} from "@goscreen/render-engine";
import {
  buildEdit,
  buildProposals,
  defaultCampaign,
  parseCampaign,
} from "@goscreen/campaign";
import {
  adoptFilm,
  alignScenesToVoice,
  applyFilm,
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
  phrasesOf,
  resolveVars,
  scenarioSchema,
  stepSchema,
} from "@goscreen/scenario";
import { z } from "zod";
import { ipc, projectsIpc } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { registry } from "@/lib/registry";
import { router } from "@/lib/router";
import { naturalSize } from "@/modules/editor/actions";
import { addBlock, updateBlock } from "@/modules/editor/blocks";
import {
  exportCurrent,
  exportRunning,
  exportVariants,
  openForExport,
  renderFrameAt,
  stopExport,
} from "@/modules/editor/exportCurrent";
import { probeDuration } from "@/modules/editor/media";
import { placeProposal } from "@/modules/editor/ProposalsPanel";
import { useSession } from "@/modules/editor/session";
import {
  SILENCE_DEFAULTS,
  soundRanges,
  stripSilences,
  trimSilentEnds,
} from "@/modules/editor/silences";
import { newId, useEdit, usePlayback } from "@/modules/editor/store";
import {
  applyState,
  currentEditOf,
  recordVersion,
  snapshotIfChanged,
} from "@/modules/editor/versions";
import {
  record,
  setValue,
  simulate,
  valuesKey,
  valuesOf,
} from "@/modules/flow/runs";
import { useFlowDoc } from "@/modules/flow/store";
import { openPlace, useTabs } from "@/modules/tabs/tabs";
import { cancelTask, deviceFor } from "@/modules/tasks/queue";
import { isFinished, type Task, useTasks } from "@/modules/tasks/store";
import { catalog, defineCommand, runningCommand } from "./registry";
import { designSoundFor, registerSoundCommands } from "./sound";
import { registerVersionCommands } from "./versions";
import { registerInspirationCommands } from "@/modules/inspiration/commands";
import { registerBlankCommands } from "./blank";
import { registerCompositionCommands } from "./compositions";
import { registerSpeechCommands } from "./speech";
import { registerMotionCommands } from "@/modules/motion/commands";
import { registerVisualCommands } from "./visual";

// The commands an AI can run. Each one is what a button of the studio does,
// on the same data, so a person and an agent can take turns on a project.

const id = z.string().min(1).describe("An id as returned by a list command");
const project = id.describe("Project id (projects.list)");
const vsl = id.describe("VSL id (vsl.list)");
const video = z
  .string()
  .min(1)
  .describe(
    "Absolute path of a recording, or of a .edit.json montage made without one (projects.videos, edit.new)",
  );

/** What a command that needs the take itself says on a montage without one. */
const NO_RECORDING =
  "This montage has no recording (it was made with edit.new): only cards and layers.";

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
  registerMotionCommands();
  registerInspirationCommands({ currentEdit, applyEdit });
  registerCompositionCommands({ currentEdit, applyEdit });
  registerBlankCommands();
  registerSpeechCommands({ currentEdit, applyEdit });
  registerVisualCommands();
  registerVersionCommands();
  registerSoundCommands({ currentEdit, applyEdit });
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
      tabs: useTabs.getState().tabs.map((t) => ({
        title: t.title,
        href: t.href,
        active: t.id === useTabs.getState().active,
      })),
      tasks: useTasks.getState().tasks.slice(0, 10).map(taskView),
    }),
  });

  defineCommand({
    name: "app.show",
    title: "Show a screen",
    description:
      "Puts a screen in front of the person: home, a project, a VSL flow, a video in the editor, the studio, or a reference video being reproduced (all references without `reference`).",
    input: z.object({
      view: z.enum([
        "home",
        "project",
        "flow",
        "editor",
        "studio",
        "reproduce",
      ]),
      project: project.optional(),
      vsl: vsl.optional(),
      video: video.optional(),
      reference: z
        .string()
        .min(1)
        .optional()
        .describe("Reference id (motion.references)"),
    }),
    run: async (i) => {
      // The AI's places open in their own tabs, so the person keeps theirs.
      if (i.view === "home") openPlace({ to: "/" });
      else if (i.view === "studio") openPlace({ to: "/studio" });
      else if (i.view === "reproduce")
        openPlace({
          to: "/reproduce",
          search: i.reference ? { reference: i.reference } : {},
        });
      else if (i.view === "project" && i.project)
        openPlace({
          to: "/projects/$project",
          params: { project: i.project },
        });
      else if (i.view === "flow" && i.project && i.vsl)
        openPlace({
          to: "/flow",
          search: { project: i.project, vsl: i.vsl },
        });
      else if (i.view === "editor" && i.video)
        openPlace({ to: "/editor", search: { video: i.video } });
      else throw new Error("Give the ids this view needs.");
      await router.load();
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
        // false: a montage made with edit.new (cards and layers only).
        recording: opened.videoUrl !== null,
        scenes: take.chapters,
        taps: take.pointers.filter((p) => p.kind === "down").length,
      };
    },
  });
  defineCommand({
    name: "edit.save",
    title: "Change a montage",
    description:
      "Replaces the edit (validated field by field; `rejected` lists every item left out, with its path and why). If the video is open, the person sees it at once and can undo it. A version is written first (edit.versions).",
    input: z.object({ video, edit: z.unknown() }),
    run: async (i) => {
      const { edit, rejected } = parseEditReport(i.edit);
      if (!edit)
        throw new Error(
          `This edit cannot be read: ${rejected.map((r) => `${r.path}: ${r.reason}`).join("; ")}`,
        );
      await applyEdit(i.video, edit);
      return {
        clips: edit.clips.length,
        overlays: edit.overlays.length,
        rejected,
      };
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
      if (opened.videoUrl === null) throw new Error(NO_RECORDING);
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
    name: "animation.presets",
    title: "List animation presets",
    description:
      "One-click animations: text animators (letters, words, lines) and motion keyframes, with what each does.",
    input: z.object({}),
    run: async () =>
      ANIMATION_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        group: p.group,
        description: p.description,
      })),
  });
  defineCommand({
    name: "edit.animate",
    title: "Animate an overlay",
    description:
      "Applies a preset to an overlay of a montage, or sets its keyframes ({x,y,scale,rotation,opacity,blur}: [{t,value,ease}], t in seconds from the overlay start) and text animator, or clears them.",
    input: z.object({
      video,
      overlay: z.string().min(1).describe("Overlay id (edit.get)"),
      preset: z.string().optional(),
      keyframes: z.unknown().optional(),
      animator: z.unknown().optional(),
      clear: z.boolean().default(false),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const o = edit.overlays.find((x) => x.id === i.overlay);
      if (!o) throw new Error("No such overlay.");
      let next: Overlay = i.clear ? clearAnimation(o) : o;
      if (i.preset) next = applyPreset(next, i.preset);
      if (i.keyframes !== undefined || i.animator !== undefined)
        next = {
          ...next,
          ...(i.keyframes !== undefined ? { keyframes: i.keyframes } : {}),
          ...(i.animator !== undefined && next.kind === "text"
            ? { animator: i.animator, enter: "none" }
            : {}),
        } as Overlay;
      // Validated like a saved file: a bad key or animator is reported.
      const checked = parseEditState({
        ...edit,
        overlays: edit.overlays.map((x) => (x.id === o.id ? next : x)),
      });
      const result = checked?.overlays.find((x) => x.id === o.id);
      if (!checked || !result)
        throw new Error("This animation cannot be read.");
      await applyEdit(i.video, checked);
      return { overlay: result };
    },
  });
  defineCommand({
    name: "edit.cleanSilences",
    title: "Cut the silences of a sound",
    description:
      'Cuts the pauses of an audio clip (a voice-over, the recording\'s mic, music): mode "strip" splits it around every pause longer than minSilence, "trim" only cuts the wait before the first word and after the last. Pieces keep their timeline time, so a voice stays in sync with the picture. Without clip: every voice-over and mic clip of the montage. Returns the clips it made.',
    input: z.object({
      video,
      clip: z.string().optional(),
      mode: z.enum(["strip", "trim"]).default("strip"),
      thresholdDb: z
        .number()
        .min(-80)
        .max(-10)
        .default(SILENCE_DEFAULTS.thresholdDb),
      minSilence: z
        .number()
        .min(0.05)
        .max(10)
        .default(SILENCE_DEFAULTS.minSilence),
    }),
    run: async (i) => {
      let edit = await currentEdit(i.video);
      if (isBlank(edit) && i.clip === MIC_ASSET)
        throw new Error(`${NO_RECORDING} There is no mic track.`);
      const voices = edit.audio.filter((a) =>
        i.clip
          ? a.id === i.clip
          : a.asset === MIC_ASSET ||
            edit.assets
              .find((x) => x.id === a.asset)
              ?.name.startsWith("Voice-over"),
      );
      if (voices.length === 0)
        throw new Error(
          i.clip ? `No audio clip ${i.clip}.` : "No voice-over or mic clip.",
        );
      const made: Record<string, string[]> = {};
      for (const clip of voices) {
        const file =
          clip.asset === MIC_ASSET
            ? ":mic"
            : edit.assets.find((x) => x.id === clip.asset)?.file;
        if (!file) continue;
        const silences = await ipc.audioSilences(
          i.video,
          file,
          i.thresholdDb,
          i.minSilence,
        );
        const o = { ...SILENCE_DEFAULTS, ...i };
        const pieces =
          i.mode === "strip"
            ? stripSilences(clip, silences, o, () => newId("aud"))
            : [trimSilentEnds(clip, silences, o)].filter(
                (c): c is AudioClip => c !== null,
              );
        if (pieces.length === 0) continue;
        made[clip.id] = pieces.map((p) => p.id);
        edit = {
          ...edit,
          audio: edit.audio.flatMap((a) => (a.id === clip.id ? pieces : [a])),
        };
      }
      await applyEdit(i.video, edit);
      return { clips: made, item: Object.values(made)[0]?.[0] };
    },
  });
  defineCommand({
    name: "edit.alignToVoice",
    title: "Let the voice lead the cut",
    description:
      "Gives each recording scene the length of its phrase in a voice clip (a voice-over, the mic): scene i runs from phrase i's attack to phrase i+1's attack, so every scene change lands on the start of a sentence and no scene opens on silence. A scene with less source than its phrase slows down (never below 0.6×); scene captions follow. Without clip: the first voice-over or mic clip. Returns how many scenes were aligned.",
    input: z.object({ video, clip: z.string().optional() }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      if (isBlank(edit))
        throw new Error(`${NO_RECORDING} There are no scenes to align.`);
      const clip = edit.audio.find((a) =>
        i.clip
          ? a.id === i.clip
          : a.asset === MIC_ASSET ||
            edit.assets
              .find((x) => x.id === a.asset)
              ?.name.startsWith("Voice-over"),
      );
      if (!clip)
        throw new Error(
          i.clip ? `No audio clip ${i.clip}.` : "No voice-over or mic clip.",
        );
      const file =
        clip.asset === MIC_ASSET
          ? ":mic"
          : edit.assets.find((x) => x.id === clip.asset)?.file;
      if (!file) throw new Error("This sound's file is missing.");
      const silences = await ipc.audioSilences(
        i.video,
        file,
        SILENCE_DEFAULTS.thresholdDb,
        SILENCE_DEFAULTS.minSilence,
      );
      const phrases = phrasesOf(
        soundRanges([clip.in, clip.in + clip.duration], silences, {
          pad: 0.05,
          minSound: 0.25,
        }),
        clip,
      );
      if (phrases.length === 0)
        throw new Error("No phrase was heard in this sound.");
      const scenes = edit.clips.filter((c) => c.kind === "recording").length;
      await applyEdit(i.video, alignScenesToVoice(edit, phrases));
      return {
        scenes: Math.min(scenes, phrases.length),
        phrases: phrases.length,
      };
    },
  });
  defineCommand({
    name: "edit.addMedia",
    title: "Add a media file",
    description:
      "Copies an image, video or audio file (absolute path) into a montage and places it at a timeline time: a sound (music, a voice-over recorded elsewhere) goes on a free audio track, an image or video on a free layer above the film. Returns the asset and the item it made.",
    input: z.object({
      video,
      file: z.string().min(1),
      start: z.number().min(0).default(0),
      // Defaults: the file's own length (audio, video), 4 s for an image.
      duration: z.number().positive().optional(),
      volume: z.number().min(0).max(2).default(1),
      x: z.number().default(0.5),
      y: z.number().default(0.5),
      width: z.number().positive().max(1).default(0.35),
    }),
    run: async (i) => {
      const asset = await ipc.assetImport(i.video, i.file);
      const open = useSession.getState().videoPath === i.video;
      if (open) useSession.getState().addAssetUrl(asset.file, asset.url);
      const length =
        asset.kind === "image"
          ? null
          : await probeDuration(asset.kind, asset.url).catch(() => null);
      const edit = await currentEdit(i.video);
      const duration = i.duration ?? length ?? 4;
      const record = {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        file: asset.file,
        duration: length,
      };
      const item = `ai-${asset.kind}-${Date.now().toString(36)}`;
      // Images and videos keep their own shape, sized against the output.
      const out = useSession.getState().source ?? { width: 9, height: 16 };
      const natural =
        asset.kind === "audio"
          ? null
          : await naturalSize(asset.kind, asset.url).catch(() => null);
      const height = natural
        ? Math.min(
            0.9,
            (i.width * out.width * natural.height) / natural.width / out.height,
          )
        : i.width;
      const free = <
        T extends { lane: number; start: number; duration: number },
      >(
        items: T[],
      ) => {
        for (let lane = 0; lane < 20; lane += 1)
          if (
            !items.some(
              (o) =>
                o.lane === lane &&
                o.start < i.start + duration &&
                i.start < o.start + o.duration,
            )
          )
            return lane;
        return 0;
      };
      const next: EditState =
        asset.kind === "audio"
          ? {
              ...edit,
              assets: [...edit.assets, record],
              audio: [
                ...edit.audio,
                {
                  id: item,
                  lane: free(edit.audio),
                  start: i.start,
                  duration,
                  asset: asset.id,
                  in: 0,
                  volume: i.volume,
                  fadeIn: 0.05,
                  fadeOut: 0.3,
                },
              ],
            }
          : {
              ...edit,
              assets: [...edit.assets, record],
              overlays: [
                ...edit.overlays,
                {
                  id: item,
                  lane: free(edit.overlays),
                  start: i.start,
                  duration,
                  x: i.x,
                  y: i.y,
                  width: i.width,
                  height,
                  rotation: 0,
                  opacity: 1,
                  enter: "pop",
                  exit: "fade",
                  motion: 0.35,
                  radius: 0.02,
                  ...(asset.kind === "image"
                    ? { kind: "image" as const, asset: asset.id }
                    : {
                        kind: "video" as const,
                        asset: asset.id,
                        in: 0,
                        volume: i.volume,
                      }),
                },
              ],
            };
      await applyEdit(i.video, next);
      return { asset: asset.id, item, kind: asset.kind };
    },
  });
  defineCommand({
    name: "edit.addText",
    title: "Add a text",
    description:
      "Adds a text overlay to a montage at a timeline time, optionally with an animation preset. Position and size are fractions of the frame.",
    input: z.object({
      video,
      text: z.string().min(1),
      start: z.number().min(0),
      duration: z.number().positive().default(3),
      x: z.number().default(0.5),
      y: z.number().default(0.5),
      width: z.number().positive().max(1).default(0.8),
      size: z.number().positive().max(0.3).default(0.06),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#ffffff"),
      weight: z.number().min(100).max(900).default(800),
      background: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .default(null),
      preset: z.string().optional(),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const look = captionLook(edit);
      const lane = Math.max(-1, ...edit.overlays.map((o) => o.lane)) + 1;
      let o: Overlay = {
        id: `ai-text-${Date.now().toString(36)}`,
        kind: "text",
        lane: Math.min(20, lane),
        start: i.start,
        duration: i.duration,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.size * 2,
        rotation: 0,
        opacity: 1,
        enter: "fade",
        exit: "fade",
        motion: 0.4,
        text: i.text,
        style: {
          font: look.font,
          size: i.size,
          weight: i.weight,
          color: i.color,
          align: "center",
          background: i.background,
          // *Words between stars* take the film's accent colour.
          accent: /\*[^*]+\*/.test(i.text) ? look.accent : undefined,
        },
      };
      if (i.preset) o = applyPreset(o, i.preset);
      const checked = parseEditState({
        ...edit,
        overlays: [...edit.overlays, o],
      });
      if (!checked) throw new Error("This text cannot be added.");
      await applyEdit(i.video, checked);
      return { overlay: o.id };
    },
  });
  defineCommand({
    name: "blocks.list",
    title: "List blocks",
    description:
      "Motion-design blocks (HTML compositions): animated titles, lower thirds, counters, charts, checklists, calls to action, steps, quotes, highlights, logo cards; with their props and default box.",
    input: z.object({}),
    run: async () =>
      BLOCKS.map((b) => ({
        id: b.id,
        label: b.label,
        description: b.description,
        box: b.box,
        duration: b.duration,
        transparent: b.transparent,
        props: b.props,
      })),
  });
  defineCommand({
    name: "edit.addBlock",
    title: "Add a block",
    description:
      "Renders a block with its props (colours default to the film's) and adds it as a layer at a timeline time. Box in fractions of the frame; defaults to the block's own.",
    input: z.object({
      video,
      block: z.string().min(1),
      props: z
        .record(z.string(), z.union([z.string(), z.number()]))
        .default({}),
      start: z.number().min(0),
      duration: z.number().min(0.5).max(60).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().max(1).optional(),
      height: z.number().positive().max(1).optional(),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const { video: path, block, props, start, ...place } = i;
      const result = await addBlock(path, edit, block, props, start, place);
      await applyEdit(path, result.edit);
      return { overlay: result.overlay };
    },
  });
  defineCommand({
    name: "edit.updateBlock",
    title: "Change a block",
    description:
      "Renders a block layer again with new props (same place and timing).",
    input: z.object({
      video,
      overlay: z.string().min(1),
      props: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
    run: async (i) => {
      const next = await updateBlock(
        i.video,
        await currentEdit(i.video),
        i.overlay,
        i.props,
      );
      await applyEdit(i.video, next);
      return { overlay: i.overlay };
    },
  });
  defineCommand({
    name: "edit.setFilm",
    title: "Change the film settings",
    description:
      "Changes a montage's film settings: look showcase|plain (showcase = the VSL layout: device framed under a numbered title, accent disc, brand cards), label (chapter kicker, e.g. 'Buyer' gives 'BUYER · 2/11'), brand, aspect, background, ink, accent, font, captions top|bottom|none, zoom, intro/outro cards {eyebrow, title with *accent words*, subtitle, duration}. A video that is not a film yet becomes one: its first and last cards become the opening and closing cards, and texts starting with a clip become scene titles. Only what came from the scenes changes; the person's own edits stay. Pass only the fields to change.",
    input: z.object({ video, film: z.record(z.string(), z.unknown()) }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const current = filmSchema.safeParse(edit.film?.settings ?? {});
      const next = filmSchema.safeParse({
        ...(current.success ? current.data : {}),
        ...i.film,
      });
      if (!next.success)
        throw new Error(
          next.error.issues
            .map((x) => `${x.path.join(".")}: ${x.message}`)
            .join("; "),
        );
      const applied = edit.film
        ? applyFilm(edit, next.data, edit.film.locale)
        : adoptFilm(edit, next.data, navigator.language || "en-US");
      await applyEdit(i.video, applied);
      const sound =
        "sound" in i.film && next.data.sound !== "none"
          ? await designSoundFor(i.video, next.data.sound, 1)
          : undefined;
      return { film: next.data, sound };
    },
  });
  defineCommand({
    name: "export.video",
    title: "Export a video",
    description:
      "Opens the video in the editor and exports its montage to MP4; returns the file and `chunks` (how many 5 s chunks were reused from the render cache and how many were rendered: after a local fix, only the chunks it touched are rendered again). The window comes to the front and the person sees the progress. One export at a time.",
    input: z.object({
      video,
      resolution: z.enum(["720", "1080", "2160"]).default("1080"),
      fps: z.union([z.literal(30), z.literal(60)]).default(30),
    }),
    run: async (i) => {
      if (exportRunning())
        throw new Error(
          "An export is already running (export.cancel to stop it).",
        );
      await openForExport(i.video);
      const { file, chunks } = await exportCurrent({
        resolution: i.resolution,
        fps: i.fps,
        label: "The AI is exporting",
      });
      return { file, chunks };
    },
  });
  defineCommand({
    name: "edit.propose",
    title: "Propose a montage from the site",
    description:
      "Reads the site (brand, pages, sections) behind an open recording and builds a complete montage from a generic recipe, with no prompt: cards (hook, name, walkthrough, call to action) and captioned shots chosen by the campaign brief, the premium screen look and a backdrop in the brand's colours. `list: true` only returns the eight proposals (recipe, format, reasons); `pick` applies one (0 = best). Objective, channels, tone, offer and call to action refine the brief. Replaces the montage (undoable).",
    input: z.object({
      video,
      url: z.string().url().optional(),
      list: z.boolean().default(false),
      pick: z.number().int().min(0).max(7).default(0),
      objective: z
        .enum([
          "launch",
          "acquisition",
          "promo",
          "feature",
          "recruit-supply",
          "awareness",
        ])
        .optional(),
      channels: z.array(z.string()).optional(),
      tone: z
        .enum(["energetic", "playful", "calm", "premium", "corporate"])
        .optional(),
      offer: z.string().optional(),
      cta: z.string().optional(),
    }),
    run: async (i) => {
      await openForExport(i.video);
      const s = useSession.getState();
      if (s.videoUrl === null)
        throw new Error(
          `${NO_RECORDING} Proposals need a take of the site: record one, or build the cards with edit.addText and edit.addBlock.`,
        );
      const url = i.url ?? s.chapters[0]?.url;
      if (!url)
        throw new Error(
          "Give the site's url: this recording has no page of its own.",
        );
      const brand = await ipc.siteBrand(url);
      const pages = [...new Set(s.chapters.map((c) => c.url))];
      const sections = [];
      for (const page of pages.length > 0 ? pages : [url]) {
        const found = await ipc.siteSections(page).catch(() => []);
        sections.push(...found.map((x) => ({ ...x, page })));
      }
      const site = { url, brand, sections };
      const base = defaultCampaign(site);
      const campaign = parseCampaign({
        ...base,
        ...(i.objective ? { objective: i.objective } : {}),
        ...(i.channels ? { channels: i.channels } : {}),
        ...(i.tone ? { tone: i.tone } : {}),
        ...(i.offer ? { offer: i.offer } : {}),
        ...(i.cta ? { cta: { ...base.cta, label: i.cta } } : {}),
      });
      const proposals = buildProposals({ site, campaign });
      const view = proposals.map((p, index) => ({
        index,
        recipe: p.recipe.id,
        label: p.recipe.label,
        format: p.format,
        variant: p.variant,
        reasons: p.reasons,
      }));
      if (i.list)
        return {
          brand: brand.name,
          sections: sections.length,
          proposals: view,
        };
      const chosen = proposals[i.pick];
      if (!chosen) throw new Error(`Only ${proposals.length} proposals.`);
      const edit = buildEdit(chosen, {
        site,
        campaign,
        duration: usePlayback.getState().duration,
        chapters: s.chapters,
      });
      await applyEdit(
        i.video,
        placeProposal(edit, s.layers, s.source, s.cameraUrl),
      );
      return {
        applied: view[i.pick],
        clips: edit.clips.length,
        overlays: edit.overlays.length,
      };
    },
  });
  defineCommand({
    name: "edit.frame",
    title: "Look at one frame",
    description:
      "Draws one frame of a montage at timeline time t with the export renderer and returns it as a JPEG (base64 `screenshot`), with the time the draw took: a way to look at the result without exporting.",
    input: z.object({
      video,
      t: z.number().min(0).default(0),
      width: z.number().int().min(240).max(1920).default(960),
    }),
    run: async (i) => {
      await openForExport(i.video);
      const r = await renderFrameAt(i.t, i.width);
      return {
        ms: r.ms,
        width: r.width,
        height: r.height,
        screenshot: r.jpeg.replace(/^data:image\/jpeg;base64,/, ""),
      };
    },
  });
  defineCommand({
    name: "export.variants",
    title: "Export several formats",
    description:
      "Exports the same film in several formats (9:16, 16:9, 1:1, 4:5), each laid out by the film's rules; returns one file per format. The montage on screen is not changed.",
    input: z.object({
      video,
      formats: z.array(z.enum(["9:16", "16:9", "1:1", "4:5"])).min(1),
      resolution: z.enum(["720", "1080", "2160"]).default("1080"),
      fps: z.union([z.literal(30), z.literal(60)]).default(30),
    }),
    run: async (i) => {
      if (exportRunning())
        throw new Error(
          "An export is already running (export.cancel to stop it).",
        );
      await openForExport(i.video);
      return exportVariants(i.formats, {
        resolution: i.resolution,
        fps: i.fps,
      });
    },
  });
  defineCommand({
    name: "export.cancel",
    title: "Stop the export",
    description: "Stops the export in progress.",
    input: z.object({}),
    run: async () => ({ stopped: await stopExport() }),
  });
}

/** The edit as the person sees it (open in the editor) or as saved. */
async function currentEdit(videoPath: string): Promise<EditState> {
  if (useSession.getState().videoPath === videoPath)
    return useEdit.getState().edit;
  const opened = await ipc.recordingOpen(videoPath);
  const edit = parseEditState(opened.edit);
  if (!edit) throw new Error("This video has no montage yet.");
  return edit;
}

/**
 * Every montage change by the AI leaves a version signed with its command,
 * written before the change reaches the editor or the disk. What the montage
 * held before is kept too when no version has it yet.
 */
async function applyEdit(videoPath: string, edit: EditState) {
  await snapshotIfChanged(videoPath, await currentEditOf(videoPath));
  await recordVersion(videoPath, {
    author: "ai",
    command: runningCommand() ?? "edit.save",
    state: edit,
  });
  await applyState(videoPath, edit, "ai");
}
