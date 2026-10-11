import type { AudioClip } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { delayed, envelope, gainAt, planVoices } from "./voicePlan";

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "aud-1",
  lane: 0,
  start: 10,
  duration: 4,
  asset: "voice",
  in: 1,
  volume: 1,
  fadeIn: 0.5,
  fadeOut: 1,
  ...over,
});

const none = () => false;

describe("planVoices", () => {
  it("waits for a clip ahead of the playhead and plays it whole", () => {
    expect(planVoices([clip()], 7, none)).toEqual([
      { clip: clip(), lead: 3, into: 0, offset: 1, duration: 4 },
    ]);
  });

  it("starts a clip under the playhead from the right place in the file", () => {
    expect(planVoices([clip()], 11.5, none)).toEqual([
      { clip: clip(), lead: 0, into: 1.5, offset: 2.5, duration: 2.5 },
    ]);
  });

  it("leaves out clips already over, skipped ones, and orders the rest", () => {
    const late = clip({ id: "b", start: 30 });
    const muted = clip({ id: "c", start: 20 });
    const plan = planVoices(
      [late, clip({ id: "done", start: 0 }), muted, clip()],
      5,
      (c) => c.id === "c",
    );
    expect(plan.map((v) => v.clip.id)).toEqual(["aud-1", "b"]);
  });
});

describe("delayed", () => {
  it("eats into the wait first, then into the clip itself", () => {
    const [v] = planVoices([clip()], 9, none);
    expect(delayed(v, 0.4)).toMatchObject({ lead: 0.6, into: 0, offset: 1 });
    expect(delayed(v, 1.5)).toMatchObject({
      lead: 0,
      into: 0.5,
      offset: 1.5,
      duration: 3.5,
    });
    expect(delayed(v, 6)).toBeNull();
  });
});

describe("gain", () => {
  it("fades in and out like the export, volume capped at 2", () => {
    const c = clip();
    expect(gainAt(c, 0)).toBe(0);
    expect(gainAt(c, 0.25)).toBe(0.5);
    expect(gainAt(c, 2)).toBe(1);
    expect(gainAt(c, 3.5)).toBe(0.5);
    expect(gainAt(c, 4)).toBe(0);
    expect(gainAt(clip({ volume: 5, fadeIn: 0, fadeOut: 0 }), 1)).toBe(2);
  });

  it("gives the curve from any point of the clip", () => {
    expect(envelope(clip(), 0)).toEqual([
      { at: 0, gain: 0 },
      { at: 0.5, gain: 1 },
      { at: 3, gain: 1 },
      { at: 4, gain: 0 },
    ]);
    expect(envelope(clip(), 3.5)).toEqual([
      { at: 0, gain: 0.5 },
      { at: 0.5, gain: 0 },
    ]);
  });
});
