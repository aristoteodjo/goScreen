import {
  compositionSchema,
  describeIssues,
  MAX_HTML_BYTES,
  parseComposition,
  SCENES,
  sceneFor,
} from "@goscreen/blocks";
import type { EditState } from "@goscreen/render-engine";
import { z } from "zod";
import { ipc } from "@/lib/ipc";
import {
  addComposition,
  findComposition,
  loadCompositions,
  previewComposition,
  renderPendingScenes,
  saveComposition,
  updateComposition,
} from "@/modules/editor/compositions";
import { defineCommand } from "./registry";

// Compositions for an AI: write an HTML page (the contract: self-contained,
// deterministic, props as {{name}} / window.__props, frames by
// window.setT(t)), look at one frame of it, place it as a layer, change it,
// keep it in the project library.

type EditAccess = {
  currentEdit: (video: string) => Promise<EditState>;
  applyEdit: (video: string, edit: EditState) => Promise<void>;
};

const video = z
  .string()
  .min(1)
  .describe(
    "Absolute path of a recording, or of a .edit.json montage made without one (projects.videos, edit.new)",
  );

const props = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .default({})
  .describe(
    "Values for the composition's props (colours default to the film's)",
  );

// The schema is published as-is; the finer rules (network, Math.random,
// size) are checked when the command runs, with the path of each issue.
const composition = compositionSchema.describe(
  `A composition: id [a-z0-9-], label, box {width,height} in px, duration (s), transparent, props [{name,label,type text|longtext|color|number,default}], html (a full page, under ${MAX_HTML_BYTES / 1024} KB). The page gets window.__props, window.__size, window.__duration and window.random(seed) before its own scripts; {{name}} in the HTML is replaced by the escaped value. It animates with CSS/WAAPI, or defines window.setT(t) and draws the frame for t seconds. No network (inline data: URLs), no Math.random, no timers or requestAnimationFrame (the renderer seeks).`,
);

function check(raw: unknown) {
  const r = parseComposition(raw);
  if (!r.ok)
    throw new Error(`Invalid composition: ${describeIssues(r.issues)}`);
  return r.composition;
}

const summary = (
  c: ReturnType<typeof check>,
  from: "video" | "library" | "scene",
) => ({
  id: c.id,
  label: c.label,
  description: c.description ?? null,
  box: c.box,
  duration: c.duration,
  transparent: c.transparent,
  props: c.props,
  from,
});

export function registerCompositionCommands({
  currentEdit,
  applyEdit,
}: EditAccess) {
  defineCommand({
    name: "compositions.list",
    title: "List compositions",
    description:
      "Compositions (HTML pages rendered as layers) kept with a video's montage and in its project library, plus the built-in scenes (from: 'scene': 3D devices, floating and stacked cards, carousel, icon grid, kinetic counter, inline-icon text, brand blur, orbit, chat, search, cursor click, glow stage), with their props and size. A scene's box is fitted to the montage's format; its 'screen' prop takes the file name of a montage asset (edit.get: assets[].file). compositions.get reads one with its HTML.",
    input: z.object({ video }),
    run: async (i) => {
      const all = await loadCompositions(i.video);
      const { aspect } = await currentEdit(i.video);
      return {
        project: all.project,
        compositions: [
          ...all.video.map((c) => summary(c, "video")),
          ...all.library.map((c) => summary(c, "library")),
          ...SCENES.map((s) => summary(sceneFor(s.id, aspect) ?? s, "scene")),
        ],
      };
    },
  });
  defineCommand({
    name: "compositions.get",
    title: "Read a composition",
    description:
      "One composition, with its HTML, from the video, its project library or the built-in scenes.",
    input: z.object({ video, id: z.string().min(1) }),
    run: async (i) =>
      findComposition(i.video, i.id, (await currentEdit(i.video)).aspect),
  });
  defineCommand({
    name: "compositions.preview",
    title: "Look at a composition",
    description:
      "Renders one frame of a composition alone at t seconds (JPEG, base64 `screenshot`, on grey when transparent) without placing it: the way to check a page before edit.addComposition. Pass the full composition, or just its id when it is already kept with the video (or a scene id).",
    input: z.object({
      video,
      composition: z.union([composition, z.string().min(1)]),
      props,
      t: z.number().min(0).max(60).default(0),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const c =
        typeof i.composition === "string"
          ? await findComposition(i.video, i.composition, edit.aspect)
          : check(i.composition);
      const screenshot = await previewComposition(
        edit,
        c,
        i.props,
        i.t,
        i.video,
      );
      return { id: c.id, t: i.t, box: c.box, screenshot };
    },
  });
  defineCommand({
    name: "edit.addComposition",
    title: "Add a composition",
    description:
      "Checks a composition, keeps it with the video, renders it with its props and adds it as a layer at a timeline time. Box in fractions of the frame (centre x, y; width, height); defaults to the page's own size, centred. Pass just the id to reuse a composition already kept with the video or in the project library, or a built-in scene id (compositions.list, from: 'scene'; a scene fills the frame). A page may show a montage asset by name: props.screen = assets[].file.",
    input: z.object({
      video,
      composition: z.union([composition, z.string().min(1)]),
      props,
      start: z.number().min(0),
      duration: z.number().min(0.1).max(60).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().max(1).optional(),
      height: z.number().positive().max(1).optional(),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const c =
        typeof i.composition === "string"
          ? await findComposition(i.video, i.composition, edit.aspect)
          : check(i.composition);
      const { video: path, start, duration, x, y, width, height } = i;
      const result = await addComposition(path, edit, c, i.props, start, {
        duration,
        x,
        y,
        width,
        height,
      });
      await applyEdit(path, result.edit);
      return { overlay: result.overlay, composition: c.id };
    },
  });
  defineCommand({
    name: "edit.renderScenes",
    title: "Render waiting scenes",
    description:
      'Renders every scene layer laid out but not rendered yet (a video layer whose source names a composition and whose asset file ends with `.pending`, as edit.propose with a dynamic recipe or the dynamic-16x9 reference write them), each at its own box and length. `screen: "recording"` takes a frame of the take at `screenAt`. Returns how many were rendered.',
    input: z.object({ video }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const opened = await ipc.recordingOpen(i.video);
      const result = await renderPendingScenes(
        i.video,
        edit,
        opened.videoUrl !== null,
      );
      if (result.rendered > 0) await applyEdit(i.video, result.edit);
      return { rendered: result.rendered };
    },
  });
  defineCommand({
    name: "edit.updateComposition",
    title: "Change a composition",
    description:
      "Renders a composition layer again with new props and/or a new page (html, props spec, duration, size, transparent: only the fields to change), same place and timing. The video's copy of the composition is updated.",
    input: z.object({
      video,
      overlay: z.string().min(1),
      props: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      html: z.string().min(1).optional(),
      composition: compositionSchema.partial().optional(),
    }),
    run: async (i) => {
      const edit = await currentEdit(i.video);
      const o = edit.overlays.find((x) => x.id === i.overlay);
      if (o?.kind !== "video" || !o.source || !("composition" in o.source))
        throw new Error("This layer is not a composition.");
      const current = await findComposition(
        i.video,
        o.source.composition,
        edit.aspect,
      );
      const patch = {
        ...(i.composition ?? {}),
        ...(i.html ? { html: i.html } : {}),
      };
      const next = await updateComposition(i.video, edit, i.overlay, {
        props: i.props,
        composition:
          Object.keys(patch).length > 0
            ? check({ ...current, ...patch, id: current.id })
            : undefined,
      });
      await applyEdit(i.video, next);
      return { overlay: i.overlay, composition: current.id };
    },
  });
  defineCommand({
    name: "compositions.save",
    title: "Save a composition to the project library",
    description:
      "Copies a composition kept with the video into its project library, so every video of the project can use it. Pass a full composition instead of an id to put a new one there directly.",
    input: z.object({
      video,
      id: z.string().min(1).optional(),
      composition: composition.optional(),
    }),
    run: async (i) => {
      const c = i.composition
        ? check(i.composition)
        : i.id
          ? await findComposition(
              i.video,
              i.id,
              (await currentEdit(i.video)).aspect,
            )
          : null;
      if (!c) throw new Error("Give an id or a composition.");
      await saveComposition(i.video, c, true);
      return { id: c.id, library: true };
    },
  });
}
