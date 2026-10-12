import { describe, expect, it } from "vitest";
import { agreement, fineTuneJsonl, pickExamples, reviewsAgree, ShotReview, type TrainingExample } from "./index.ts";

const text = (...ws: string[]) => ShotReview.parse({ kind: "text", lines: [ws.map((t) => ({ text: t, accent: t.endsWith("*"), strike: false }))] });
const ex = (id: string, created: number, student: ShotReview | null, teacher: ShotReview, reference = "a"): TrainingExample => ({
  id, task: "shot-review", created, reference, shot: "s", image: `${id}.jpg`, prompt: "p", student, teacher, teacherName: "claude",
});

describe("reviewsAgree", () => {
  it("compares words, accents and kind", () => {
    expect(reviewsAgree(text("L'IA", "qui"), text("L'IA", "qui"))).toBe(true);
    expect(reviewsAgree(text("LIA", "qui"), text("L'IA", "qui"))).toBe(false);
    const logo = ShotReview.parse({ kind: "logo", description: "x" });
    expect(reviewsAgree(logo, ShotReview.parse({ kind: "logo", description: "y" }))).toBe(true);
    expect(reviewsAgree(logo, text("x"))).toBe(false);
  });
});

describe("pickExamples", () => {
  it("shows the student's mistakes first, oldest first", () => {
    const right = ex("right", 3, text("a"), text("a"));
    const wrong = ex("wrong", 1, text("LIA"), text("L'IA"));
    const other = ex("other", 2, text("x"), text("y"), "b");
    expect(pickExamples([right, wrong, other], "a", 2).map((e) => e.id)).toEqual(["wrong", "other"]);
  });
});

describe("agreement", () => {
  it("counts what the student already knew", () => {
    const a = agreement([ex("1", 1, text("LIA"), text("L'IA")), ex("2", 2, text("a"), text("a")), ex("3", 3, null, text("b"))]);
    expect(a).toEqual({ examples: 3, judged: 2, agreed: 1, recent: 0.5 });
  });
});

it("fineTuneJsonl writes one chat per line with its image", () => {
  const line = JSON.parse(fineTuneJsonl([ex("1", 1, null, text("a"))]));
  expect(line.images).toEqual(["examples/1.jpg"]);
  expect(line.messages.at(-1)).toEqual({ role: "assistant", content: JSON.stringify(text("a")) });
});
