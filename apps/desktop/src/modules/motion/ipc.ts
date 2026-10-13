import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

// Typed calls to the Rust side: reference videos (modules/motion) and the
// local vision model (modules/local_ai). Every answer is checked here.

const referenceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  video: z.string(),
  created: z.number(),
  files: z.array(z.string()),
});
export type Reference = z.infer<typeof referenceSchema>;

const progressSchema = z.object({
  type: z.string(),
  script: z.string().optional(),
  step: z.string().optional(),
  done: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
});
export type MotionProgress = z.infer<typeof progressSchema>;
export const parseMotionProgress = (v: unknown) => progressSchema.safeParse(v);

const name = z.string().min(1);

export const motionIpc = {
  references: async () =>
    z.array(referenceSchema).parse(await invoke("motion_references")),
  create: async (video: string) =>
    referenceSchema.parse(await invoke("motion_reference_create", { video })),
  remove: async (id: string) => {
    await invoke("motion_reference_delete", { id });
  },
  read: async (id: string, file: string) =>
    z.string().parse(await invoke("motion_read", { id, file })),
  /** The path of a file of a reference (to import it into an edit). */
  filePath: async (id: string, file: string) =>
    z.string().parse(await invoke("motion_file_path", { id, file })),
  readJson: async (id: string, file: string): Promise<unknown> =>
    JSON.parse(await motionIpc.read(id, file)),
  write: async (id: string, file: string, value: unknown) => {
    await invoke("motion_write", {
      id,
      file,
      content: JSON.stringify(value, null, 1),
    });
  },
  /** A frame as a JPEG data URL; `video` is "reference" or a rendering's file. */
  frame: async (id: string, video: string, time: number, width?: number) =>
    z
      .string()
      .startsWith("data:image/jpeg;base64,")
      .parse(await invoke("motion_frame", { id, video, time, width })),
  videoUrl: async (id: string, video: string) =>
    z.string().url().parse(await invoke("motion_video_url", { id, video })),
  /** Measures a video of the reference; returns the observations file. */
  analyze: async (id: string, video: string) =>
    name.parse(await invoke("motion_analyze", { id, video })),
  render: async (
    id: string,
    job: { html: string; width: number; height: number; fps: number; duration: number },
  ) => name.parse(await invoke("motion_render", { id, ...job })),
  cancel: async () => {
    await invoke("motion_cancel");
  },
};

const modelSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  kind: z.enum(["vision", "ocr"]),
  size: z.number(),
  installed: z.boolean(),
});
export type LocalModel = z.infer<typeof modelSchema>;

const statusSchema = z.object({
  server: z.string().nullable(),
  models: z.array(modelSchema),
  running: z.string().nullable(),
  downloading: z.string().nullable(),
});
export type LocalAiStatus = z.infer<typeof statusSchema>;

const installProgressSchema = z.object({
  model: z.string(),
  type: z.enum(["progress", "done", "error"]),
  done: z.number().optional(),
  total: z.number().optional(),
  message: z.string().nullable().optional(),
});
export const parseInstallProgress = (v: unknown) =>
  installProgressSchema.safeParse(v);

const chatSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});

export const localAiIpc = {
  status: async () => statusSchema.parse(await invoke("local_ai_status")),
  install: async (id: string) => {
    await invoke("local_ai_install", { id });
  },
  cancelInstall: async () => {
    await invoke("local_ai_cancel_install");
  },
  remove: async (id: string) => {
    await invoke("local_ai_remove", { id });
  },
  start: async (id: string) => {
    await invoke("local_ai_start", { id });
    remember(id);
  },
  stop: async () => {
    await invoke("local_ai_stop");
    remember(null);
  },
  /** One answer of the running model, as text. */
  chat: async (request: unknown) => {
    const r = chatSchema.parse(await invoke("local_ai_chat", { request }));
    return r.choices[0].message.content ?? "";
  },
};

export const trainingIpc = {
  /** Keeps an example (its id and image name are set by Rust). */
  add: async (example: unknown, image: string) =>
    z.string().min(1).parse(await invoke("training_add", { example, image })),
  list: async (withImages = false): Promise<unknown[]> =>
    z.array(z.unknown()).parse(await invoke("training_list", { withImages })),
  remove: async (id: string) => {
    await invoke("training_remove", { id });
  },
  /** Writes train.jsonl; returns the training folder. */
  export: async (jsonl: string) =>
    z.string().min(1).parse(await invoke("training_export", { jsonl })),
};

// The model the person keeps running: started again when the app starts, and
// before the local model is asked anything (it stops with the app).
const KEEP_KEY = "goscreen.localModel";
function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(KEEP_KEY, id);
    else localStorage.removeItem(KEEP_KEY);
  } catch {}
}

/** The local model running, started again if it was kept on; whether it runs. */
export async function ensureLocalModel(): Promise<boolean> {
  const status = await localAiIpc.status();
  if (status.running) return true;
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEEP_KEY);
  } catch {}
  if (!id || !status.models.some((m) => m.id === id && m.installed)) return false;
  await invoke("local_ai_start", { id });
  return true;
}
