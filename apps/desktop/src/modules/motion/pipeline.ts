import {
  applyReview,
  fewShotMessages,
  fidelity,
  fineTuneJsonl,
  type MotionSpec,
  measureShots,
  Observations,
  parseMotionSpec,
  pickExamples,
  REVIEW_SYSTEM,
  reviewPrompt,
  SHOT_REVIEW_SCHEMA,
  ShotReview,
  type ShotMeasure,
  shotKeyTime,
  specFromObservations,
  specHtml,
  TrainingExample,
} from "@goscreen/motion";
import { z } from "zod";
import { localAiIpc, motionIpc, trainingIpc } from "./ipc";

// Reproducing a reference video, one step at a time: measure it, derive a
// spec, let a model correct what OCR cannot know, render the spec, measure
// the rendering the same way and compare. Every step reads and writes the
// reference's folder, so the studio, an AI through MCP and a person editing
// spec.json all work on the same files.

export const FILES = {
  observations: "reference.observations.json",
  /** The spec as derived, before any correction (kept to compare). */
  auto: "spec.auto.json",
  spec: "spec.json",
};

export async function loadObservations(id: string, file = FILES.observations) {
  return Observations.parse(await motionIpc.readJson(id, file));
}

export async function loadSpec(id: string): Promise<MotionSpec> {
  const r = parseMotionSpec(await motionIpc.readJson(id, FILES.spec));
  if (!r.ok) throw new Error(`spec.json: ${r.error}`);
  return r.spec;
}

export async function saveSpec(id: string, spec: MotionSpec) {
  const r = parseMotionSpec(spec);
  if (!r.ok) throw new Error(r.error);
  await motionIpc.write(id, FILES.spec, r.spec);
  return r.spec;
}

/** 1. Measures the reference video. */
export async function analyzeReference(id: string) {
  const file = await motionIpc.analyze(id, "reference");
  return loadObservations(id, file);
}

/** 2. A first spec from the measurements, without AI. */
export async function deriveSpec(id: string) {
  const spec = specFromObservations(await loadObservations(id));
  await motionIpc.write(id, FILES.auto, spec);
  return saveSpec(id, spec);
}

/** A model's answer: JSON, sometimes wrapped in a code fence. */
export function parseReviewAnswer(text: string) {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "");
  return ShotReview.parse(JSON.parse(json));
}

/** The teacher's examples, read back (malformed ones skipped). */
export async function loadExamples(withImages = false) {
  const withImage = TrainingExample.extend({ imageData: z.string().default("") });
  return (await trainingIpc.list(withImages)).flatMap((v) => {
    const r = withImage.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

/** Where the student's last answer about a shot is kept. */
const studentFile = (shotId: string) => `review-${shotId}.local.json`;

/**
 * 3. The local model looks at one shot and corrects it. Before the question,
 * it sees a few shots its teacher already answered (few-shot): what it
 * learnt so far. Its answer is kept, to be compared when the teacher passes.
 */
export async function reviewShot(id: string, spec: MotionSpec, index: number) {
  const shot = spec.shots[index];
  const frame = await motionIpc.frame(id, "reference", shotKeyTime(shot), 768);
  const prompt = reviewPrompt(shot);
  const lessons = pickExamples(await loadExamples(true), id, 3);
  const answer = await localAiIpc.chat({
    messages: [
      { role: "system", content: REVIEW_SYSTEM },
      ...fewShotMessages(lessons as (TrainingExample & { imageData: string })[]),
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: frame } },
          { type: "text", text: prompt },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 800,
    response_format: {
      type: "json_schema",
      json_schema: { name: "shot_review", schema: SHOT_REVIEW_SCHEMA },
    },
  });
  const review = parseReviewAnswer(answer);
  await motionIpc.write(id, studentFile(shot.id), { prompt, review });
  const shots = spec.shots.map((s, i) => (i === index ? applyReview(s, review) : s));
  return { spec: { ...spec, shots }, review, lessons: lessons.length };
}

/**
 * A teacher (Claude, a person) answers about a shot: the spec takes the
 * answer, and it becomes an example the local model learns from, with what
 * the student had said (if it had) to measure its progress.
 */
export async function teachShot(
  id: string,
  shotId: string,
  answer: ShotReview,
  teacherName: string,
) {
  const spec = await loadSpec(id);
  const index = spec.shots.findIndex((s) => s.id === shotId);
  if (index < 0) throw new Error(`No shot ${shotId}.`);
  const shot = spec.shots[index];
  // The question as the student got it (its answer may have changed the
  // shot since), else as it reads now.
  let prompt = reviewPrompt(shot);
  let student: ShotReview | null = null;
  try {
    const kept = z
      .object({ prompt: z.string(), review: ShotReview })
      .parse(await motionIpc.readJson(id, studentFile(shot.id)));
    prompt = kept.prompt;
    student = kept.review;
  } catch {
    // The local model never looked at this shot.
  }
  const frame = await motionIpc.frame(id, "reference", shotKeyTime(shot), 768);
  const example = await trainingIpc.add(
    {
      task: "shot-review",
      created: Date.now(),
      reference: id,
      shot: shot.id,
      prompt,
      student,
      teacher: answer,
      teacherName,
    },
    frame,
  );
  const shots = spec.shots.map((s, i) => (i === index ? applyReview(s, answer) : s));
  return { spec: await saveSpec(id, { ...spec, shots }), example, student };
}

/** Writes the fine-tuning dataset; returns the training folder. */
export async function exportTraining() {
  return trainingIpc.export(fineTuneJsonl(await loadExamples(false)));
}

/** Every shot in turn; the spec is saved after each one. */
export async function reviewAll(
  id: string,
  onShot: (index: number, total: number) => void,
) {
  let spec = await loadSpec(id);
  for (let i = 0; i < spec.shots.length; i++) {
    onShot(i, spec.shots.length);
    spec = await saveSpec(id, (await reviewShot(id, spec, i)).spec);
  }
  return spec;
}

export type RenderReport = {
  render: string;
  /** Mean fidelity of the text shots, 0..1. */
  score: number;
  shots: (ShotMeasure & { fidelity: number })[];
};

/** 4. Renders the spec, measures the rendering, compares it shot by shot. */
export async function renderAndMeasure(id: string, fps = 30): Promise<RenderReport> {
  const spec = await loadSpec(id);
  const render = await motionIpc.render(id, {
    html: specHtml(spec),
    width: spec.width,
    height: spec.height,
    fps,
    duration: spec.duration,
  });
  const stem = render.replace(/\.mp4$/, "");
  await motionIpc.write(id, `${stem}.spec.json`, spec);
  const out = await loadObservations(id, await motionIpc.analyze(id, render));
  const shots = measureShots(spec, await loadObservations(id), out).map((m) => ({
    ...m,
    fidelity: fidelity(m),
  }));
  const report: RenderReport = {
    render,
    score: shots.length ? shots.reduce((s, m) => s + m.fidelity, 0) / shots.length : 0,
    shots,
  };
  await motionIpc.write(id, `${stem}.report.json`, report);
  return report;
}

/** The latest rendering's report, if any. */
export async function latestReport(id: string, files: string[]) {
  const n = Math.max(
    0,
    ...files.map((f) => Number(f.match(/^render-(\d+)\.report\.json$/)?.[1] ?? 0)),
  );
  if (!n) return null;
  return (await motionIpc.readJson(id, `render-${n}.report.json`)) as RenderReport;
}
