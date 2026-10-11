import { describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  animatorAt,
  animatorLength,
  applyPreset,
  clearAnimation,
  cubicBezier,
  eased,
  keyTimes,
  type Overlay,
  parseEditState,
  propsAt,
  setKey,
  type TextAnimator,
  unitRanks,
  unitsOf,
  valueAt,
} from "./index";

const text = (patch: Partial<Overlay> = {}): Overlay =>
  ({
    id: "t1",
    kind: "text",
    lane: 0,
    start: 10,
    duration: 4,
    x: 0.5,
    y: 0.5,
    width: 0.5,
    height: 0.1,
    rotation: 0,
    opacity: 1,
    enter: "fade",
    exit: "fade",
    motion: 0.4,
    text: "Hello big world",
    style: {
      font: "Inter",
      size: 0.05,
      weight: 700,
      color: "#ffffff",
      align: "center",
      background: null,
    },
    ...patch,
  }) as Overlay;

describe("curves", () => {
  it("matches CSS cubic-bezier at the ends and the middle", () => {
    expect(cubicBezier([0.42, 0, 0.58, 1], 0)).toBe(0);
    expect(cubicBezier([0.42, 0, 0.58, 1], 1)).toBe(1);
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 3);
  });

  it("ease-out runs ahead, ease-in lags, hold waits", () => {
    expect(eased("out", 0.3)).toBeGreaterThan(0.3);
    expect(eased("in", 0.3)).toBeLessThan(0.3);
    expect(eased("hold", 0.99)).toBe(0);
    expect(eased("hold", 1)).toBe(1);
  });

  it("back and spring overshoot, then land", () => {
    const back = Array.from({ length: 50 }, (_, i) => eased("back", i / 49));
    expect(Math.max(...back)).toBeGreaterThan(1);
    expect(eased("spring", 1)).toBe(1);
    expect(eased("elastic", 1)).toBe(1);
  });
});

describe("keyframes", () => {
  const keys = [
    { t: 0, value: 0, ease: "linear" as const },
    { t: 2, value: 10, ease: "hold" as const },
    { t: 3, value: 20, ease: "linear" as const },
  ];

  it("holds before the first and after the last key", () => {
    expect(valueAt(keys, -1)).toBe(0);
    expect(valueAt(keys, 9)).toBe(20);
    expect(valueAt([], 1)).toBeNull();
  });

  it("follows each key's ease to the next", () => {
    expect(valueAt(keys, 1)).toBe(5);
    expect(valueAt(keys, 2.5)).toBe(10);
    expect(valueAt(keys, 3)).toBe(20);
  });

  it("drives the overlay's properties in timeline time", () => {
    const o = text({
      keyframes: {
        x: [
          { t: 0, value: 0.2, ease: "linear" },
          { t: 2, value: 0.6, ease: "linear" },
        ],
        opacity: [{ t: 0, value: 3, ease: "linear" }],
      },
    });
    const p = propsAt(o, 11);
    expect(p.x).toBeCloseTo(0.4);
    expect(p.y).toBe(0.5);
    expect(p.scale).toBe(1);
    expect(p.opacity).toBe(1);
  });

  it("replaces a key at the same time, keeping its ease", () => {
    const one = setKey(undefined, 1, 5, "back");
    const two = setKey(one, 1.001, 7);
    expect(two).toEqual([{ t: 1.001, value: 7, ease: "back" }]);
    expect(setKey(two, 0, 1).map((k) => k.t)).toEqual([0, 1.001]);
  });

  it("lists key times once for the timeline", () => {
    const o = text({
      keyframes: {
        x: [{ t: 1, value: 0, ease: "linear" }],
        y: [
          { t: 1, value: 0, ease: "linear" },
          { t: 2, value: 0, ease: "linear" },
        ],
      },
    });
    expect(keyTimes(o)).toEqual([1, 2]);
  });
});

describe("text animators", () => {
  const anim: TextAnimator = {
    unit: "word",
    order: "forward",
    stagger: 0.1,
    duration: 0.5,
    ease: "linear",
    from: { opacity: 0, dx: 0, dy: 1, scale: 1, rotation: 0, blur: 0 },
    exit: false,
  };

  it("splits text into chars, words or lines, without spaces", () => {
    expect(unitsOf(["ab c"], "char").map((u) => u.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(unitsOf(["ab c", "d"], "word").map((u) => [u.text, u.line])).toEqual(
      [
        ["ab", 0],
        ["c", 0],
        ["d", 1],
      ],
    );
    expect(unitsOf(["one", " "], "line")).toHaveLength(1);
  });

  it("orders units forward, backward, from the centre or shuffled", () => {
    expect(unitRanks(4, "reverse")).toEqual([3, 2, 1, 0]);
    expect(unitRanks(5, "center")).toEqual([2, 1, 0, 1, 2]);
    const random = unitRanks(6, "random");
    expect([...random].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(unitRanks(6, "random")).toEqual(random);
  });

  it("brings each unit in after the one before", () => {
    const at = animatorAt(anim, 3, 0.25, 4);
    expect(at[0].opacity).toBeCloseTo(0.5);
    expect(at[1].opacity).toBeCloseTo(0.3);
    expect(at[2].opacity).toBeCloseTo(0.1);
    expect(animatorAt(anim, 3, 0.05, 4)[2].opacity).toBe(0);
    expect(at[0].dy).toBeCloseTo(0.5);
    expect(animatorLength(anim, 3)).toBeCloseTo(0.7);
    expect(
      animatorAt(anim, 3, 1, 4).every((u) => u.opacity === 1 && u.dy === 0),
    ).toBe(true);
  });

  it("sends units out the same way when asked", () => {
    const exits = { ...anim, exit: true };
    expect(animatorAt(exits, 3, 2, 4)[0].opacity).toBe(1);
    expect(animatorAt(exits, 3, 4, 4).every((u) => u.opacity === 0)).toBe(true);
  });
});

describe("presets", () => {
  it("text presets set an animator, motion presets write keyframes", () => {
    const o = text();
    const words = applyPreset(o, "words-up");
    expect(words.kind === "text" && words.animator?.unit).toBe("word");
    const drop = applyPreset(o, "drop-in");
    expect(drop.keyframes?.y?.[0].value).toBeCloseTo(0.38);
    expect(propsAt(drop, o.start + 1).y).toBeCloseTo(0.5);
    expect(() => applyPreset(o, "nope")).toThrow();
  });

  it("every preset gives an edit the editor reads back", () => {
    for (const p of ANIMATION_PRESETS) {
      const o = p.apply(text());
      const edit = parseEditState({
        version: 2,
        aspect: "16:9",
        clips: [],
        overlays: [o],
        zooms: [],
      });
      expect(edit?.overlays[0]).toEqual(o);
    }
  });

  it("clearing goes back to the simple motions", () => {
    const o = clearAnimation(
      applyPreset(applyPreset(text(), "words-up"), "pulse"),
    );
    expect(o.keyframes).toBeUndefined();
    expect(o.kind === "text" && o.animator).toBeNull();
    expect(o.enter).toBe("fade");
  });
});
