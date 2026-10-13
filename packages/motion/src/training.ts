import { z } from "zod";
import { REVIEW_SYSTEM, ShotReview } from "./review.ts";

// The local model learns from a teacher (Claude through MCP, or a person):
// every answer the teacher gives about a shot is kept as an example, with
// the frame, the question and what the local model (the student) had said.
// Right away, the nearest examples go into the student's next questions
// (few-shot); their agreement over time shows whether it learns; and the
// whole set exports as a fine-tuning dataset (LoRA) once it is large enough.

export const TrainingExample = z.object({
  id: z.string().min(1),
  task: z.literal("shot-review"),
  created: z.number(),
  /** Reference and shot it comes from. */
  reference: z.string(),
  shot: z.string(),
  /** The frame, a JPEG next to the example (`<id>.jpg`). */
  image: z.string(),
  prompt: z.string(),
  /** What the local model answered before the correction, if it had. */
  student: ShotReview.nullable(),
  teacher: ShotReview,
  /** Who taught: "claude", "person"… */
  teacherName: z.string().min(1),
});
export type TrainingExample = z.infer<typeof TrainingExample>;

const words = (r: ShotReview) =>
  r.lines
    .flat()
    .map((w) => `${w.text.normalize("NFC")}${w.accent ? "*" : ""}${w.strike ? "~" : ""}`)
    .join(" ");

/** Same kind, same words, same accents and strikes, same kicker. */
export function reviewsAgree(a: ShotReview, b: ShotReview): boolean {
  if (a.kind !== b.kind) return false;
  // What is behind and in front, when both said it: the same kinds of things.
  if (a.background && b.background && a.background.kind !== b.background.kind) return false;
  const roles = (r: ShotReview) => [...new Set(r.elements.map((e) => e.role))].sort().join(",");
  if (a.elements.length && b.elements.length && roles(a) !== roles(b)) return false;
  if (a.kind !== "text") return true;
  return words(a) === words(b) && (a.kicker ?? "") === (b.kicker ?? "");
}

/**
 * The examples to show the student before a question: the most instructive
 * first (where it was wrong), from the same reference when possible (same
 * style), then the most recent; one per shot kind at most twice.
 */
export function pickExamples(
  examples: TrainingExample[],
  reference: string,
  count = 3,
): TrainingExample[] {
  const wrong = (e: TrainingExample) => !e.student || !reviewsAgree(e.student, e.teacher);
  const ranked = [...examples].sort(
    (a, b) =>
      Number(wrong(b)) - Number(wrong(a)) ||
      Number(b.reference === reference) - Number(a.reference === reference) ||
      b.created - a.created,
  );
  const picked: TrainingExample[] = [];
  const perKind = new Map<string, number>();
  for (const e of ranked) {
    const n = perKind.get(e.teacher.kind) ?? 0;
    if (n >= 2) continue;
    perKind.set(e.teacher.kind, n + 1);
    picked.push(e);
    if (picked.length === count) break;
  }
  // Oldest first, like a conversation.
  return picked.sort((a, b) => a.created - b.created);
}

/** Past questions and the teacher's answers, as chat turns before the new one. */
export function fewShotMessages(examples: (TrainingExample & { imageData: string })[]) {
  return examples.flatMap((e) => [
    {
      role: "user" as const,
      content: [
        { type: "image_url" as const, image_url: { url: e.imageData } },
        { type: "text" as const, text: e.prompt },
      ],
    },
    { role: "assistant" as const, content: JSON.stringify(e.teacher) },
  ]);
}

export type Agreement = {
  examples: number;
  /** Examples where the student had answered first. */
  judged: number;
  agreed: number;
  /** Agreement over the last `window` judged examples (0..1), null if none. */
  recent: number | null;
};

/** How often the student already said what the teacher said. */
export function agreement(examples: TrainingExample[], window = 20): Agreement {
  const judged = [...examples]
    .filter((e) => e.student)
    .sort((a, b) => a.created - b.created);
  const ok = (e: TrainingExample) => reviewsAgree(e.student as ShotReview, e.teacher);
  const last = judged.slice(-window);
  return {
    examples: examples.length,
    judged: judged.length,
    agreed: judged.filter(ok).length,
    recent: last.length ? last.filter(ok).length / last.length : null,
  };
}

/** Enough examples for a fine-tune to be worth it (below, few-shot does better). */
export const FINE_TUNE_MIN_EXAMPLES = 200;

/**
 * The dataset for a LoRA fine-tune (mlx-vlm / OpenAI chat format, one JSON
 * per line), images as paths relative to the training folder.
 */
export function fineTuneJsonl(examples: TrainingExample[]): string {
  return examples
    .map((e) =>
      JSON.stringify({
        images: [`examples/${e.image}`],
        messages: [
          { role: "system", content: REVIEW_SYSTEM },
          {
            role: "user",
            content: [{ type: "image" }, { type: "text", text: e.prompt }],
          },
          { role: "assistant", content: JSON.stringify(e.teacher) },
        ],
      }),
    )
    .join("\n");
}
