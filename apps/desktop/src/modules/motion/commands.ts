import {
  agreement,
  FIDELITY_PASS,
  FINE_TUNE_MIN_EXAMPLES,
  reviewPrompt,
  reviewsAgree,
  ShotReview,
  shotKeyTime,
} from "@goscreen/motion";
import { z } from "zod";
import { aiShowReference } from "@/modules/control/aiStage";
import { defineCommand } from "@/modules/control/registry";
import { localAiIpc, motionIpc } from "./ipc";
import {
  analyzeReference,
  deriveSpec,
  exportTraining,
  loadExamples,
  loadSpec,
  renderAndMeasure,
  reviewShot,
  saveSpec,
  teachShot,
} from "./pipeline";
import { refreshMotion } from "./store";

// The same steps as the Reproduce screen, for an AI through MCP. Claude is
// the teacher here: `motion.teach` writes its answer into the spec and keeps
// it as an example the in-app model learns from.

const reference = z.string().min(1).describe("Reference id (motion.references)");
const shot = z.string().min(1).describe("Shot id (motion.spec)");
const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

const shotSummary = (s: Awaited<ReturnType<typeof loadSpec>>["shots"][number]) =>
  s.kind === "text"
    ? {
        id: s.id,
        kind: s.kind,
        start: s.start,
        end: s.end,
        text: s.lines.map((l) => l.words.map((w) => w.text).join(" ")).join(" / "),
      }
    : { id: s.id, kind: s.kind, start: s.start, end: s.end, label: s.label };

export function registerMotionCommands() {
  defineCommand({
    name: "motion.references",
    title: "List reference videos",
    description:
      "Reference videos being reproduced, newest first, with the files of each (observations, spec.json, render-N.mp4, render-N.report.json).",
    input: z.object({}),
    run: () => motionIpc.references(),
  });

  defineCommand({
    name: "motion.create",
    title: "Start reproducing a video",
    description:
      "Creates a reference from a video file (absolute path), then measures it and derives a first spec: cuts, text shots, words with their timing, colours, underlines. Takes about a second per second of video.",
    input: z.object({ video: z.string().min(1).describe("Absolute path of the video") }),
    run: async ({ video }) => {
      const ref = await motionIpc.create(video);
      // The person following the AI sees the new reference being measured.
      void aiShowReference(ref.id, "Measuring the video…");
      await analyzeReference(ref.id);
      const spec = await deriveSpec(ref.id);
      refreshMotion();
      return { reference: ref.id, shots: spec.shots.map(shotSummary) };
    },
  });

  defineCommand({
    name: "motion.spec",
    title: "Read a spec",
    description:
      "The motion spec of a reference: shots on a timeline (text shots with lines, words timed one by one, accent, strike, underline, kicker; placeholders for what is not rebuilt yet). Positions are fractions of the frame, sizes fractions of its height, times in seconds.",
    input: z.object({ reference }),
    run: ({ reference }) => loadSpec(reference),
  });

  defineCommand({
    name: "motion.setSpec",
    title: "Write a spec",
    description:
      "Replaces the spec of a reference (validated; the error names the wrong field). To correct the words of a shot, prefer motion.teach: it also teaches the local model.",
    input: z.object({ reference, spec: z.unknown() }),
    run: async ({ reference, spec }) => {
      const saved = await saveSpec(reference, spec as never);
      refreshMotion();
      return { shots: saved.shots.length };
    },
  });

  defineCommand({
    name: "motion.frame",
    title: "See a frame",
    description: "A frame of the reference video (or of a rendering, e.g. render-2.mp4) at a time, as an image.",
    input: z.object({
      reference,
      time: z.number().min(0),
      video: z.string().default("reference"),
    }),
    run: async ({ reference, time, video }) => ({
      screenshot: base64(await motionIpc.frame(reference, video, time, 1280)),
    }),
  });

  defineCommand({
    name: "motion.shot",
    title: "Look at a shot",
    description:
      "One shot as the local model sees it: its frame (image), the question it is asked, its spec, and what the local model answered if it already looked. Answer with motion.teach.",
    input: z.object({ reference, shot }),
    run: async ({ reference, shot: shotId }) => {
      const spec = await loadSpec(reference);
      const s = spec.shots.find((x) => x.id === shotId);
      if (!s) throw new Error(`No shot ${shotId}.`);
      let student: unknown = null;
      try {
        student = await motionIpc.readJson(reference, `review-${s.id}.local.json`);
      } catch {
        // Not reviewed by the local model yet.
      }
      return {
        shot: s,
        question: reviewPrompt(s),
        answerFormat:
          '{ "kind": "text|logo|interface|other", "lines": [[{ "text", "accent", "strike" }]], "kicker": string|null, "description": string }',
        localModel: student,
        screenshot: base64(await motionIpc.frame(reference, "reference", shotKeyTime(s), 1280)),
      };
    },
  });

  defineCommand({
    name: "motion.teach",
    title: "Teach a shot",
    description:
      "Your answer about a shot (same format as the local model's): the spec takes it (words and styles on the measured timing; a logo or interface becomes a named placeholder), and it is kept as an example the in-app model learns from. Returns whether the local model had already said the same.",
    input: z.object({ reference, shot, answer: ShotReview }),
    run: async ({ reference, shot: shotId, answer }) => {
      const r = await teachShot(reference, shotId, answer, "claude");
      refreshMotion();
      return {
        example: r.example,
        localModelAnswered: r.student !== null,
        localModelAgreed: r.student ? reviewsAgree(r.student, answer) : null,
      };
    },
  });

  defineCommand({
    name: "motion.reviewLocal",
    title: "Ask the local model",
    description:
      "The in-app model (must be running) reviews one shot, or every shot, with what it learnt so far as examples. Its answers go into the spec and are kept to be compared with yours.",
    input: z.object({ reference, shot: shot.optional() }),
    run: async ({ reference, shot: only }) => {
      let spec = await loadSpec(reference);
      const answers = [];
      for (let i = 0; i < spec.shots.length; i++) {
        if (only && spec.shots[i].id !== only) continue;
        const r = await reviewShot(reference, spec, i);
        spec = await saveSpec(reference, r.spec);
        answers.push({ shot: spec.shots[i].id, answer: r.review, lessons: r.lessons });
      }
      refreshMotion();
      return answers;
    },
  });

  defineCommand({
    name: "motion.render",
    title: "Render and measure",
    description: `Renders the spec to render-N.mp4, measures it like the reference and compares shot by shot: words found, timing, position, size, colour, and a fidelity per shot (passes at ${FIDELITY_PASS}). About a minute and a half for 30 s of video.`,
    input: z.object({ reference }),
    run: async ({ reference }) => {
      const report = await renderAndMeasure(reference);
      refreshMotion();
      return report;
    },
  });

  defineCommand({
    name: "training.stats",
    title: "Local model progress",
    description:
      "How much the in-app model has learnt: examples taught, and how often it already agreed with the teacher (overall and over the last 20).",
    input: z.object({}),
    run: async () => {
      const status = await localAiIpc.status();
      return {
        ...agreement(await loadExamples(false)),
        fineTuneFrom: FINE_TUNE_MIN_EXAMPLES,
        running: status.running,
      };
    },
  });

  defineCommand({
    name: "training.export",
    title: "Export the training set",
    description: "Writes every example as train.jsonl (chat format with images) for a LoRA fine-tune; returns the folder.",
    input: z.object({}),
    run: async () => ({ folder: await exportTraining() }),
  });
}
