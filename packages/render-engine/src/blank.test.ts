import { describe, expect, it } from "vitest";
import {
  blankEdit,
  blankSource,
  DEFAULT_EDIT,
  fullClip,
  isBlank,
  montageEnd,
  parseEditReport,
  parseEditState,
  sequenceDuration,
} from "./index";

describe("a montage without a recording", () => {
  it("starts from one card of the asked length, in its format at 1080p", () => {
    const edit = blankEdit({ aspect: "9:16", duration: 20 });
    expect(isBlank(edit)).toBe(true);
    expect(edit.source).toEqual({ kind: "none", width: 1080, height: 1920 });
    expect(edit.aspect).toBe("9:16");
    expect(edit.clips).toHaveLength(1);
    expect(sequenceDuration(edit.clips)).toBe(20);
    expect(edit.layers).toEqual([]);
    expect(edit.zooms).toEqual([]);
    expect(edit.touch.style).toBe("none");
    expect(edit.cursor.visible).toBe(false);
    expect(blankSource("16:9")).toEqual({
      kind: "none",
      width: 1920,
      height: 1080,
    });
    expect(blankSource("1:1")).toEqual({
      kind: "none",
      width: 1920,
      height: 1920,
    });
    // "auto" has nothing to follow: the default format stands in.
    expect(blankSource("auto")).toEqual(blankSource("16:9"));
  });

  it("is read back as such, and keeps the recording's montages untouched", () => {
    const edit = blankEdit({ aspect: "1:1", duration: 8 });
    const back = parseEditState(JSON.parse(JSON.stringify(edit)));
    expect(back).toEqual(edit);
    expect(isBlank(DEFAULT_EDIT)).toBe(false);
    expect(parseEditState({ ...DEFAULT_EDIT })?.source).toBeUndefined();
  });

  it("refuses a recording clip, with its reason, and never ends empty", () => {
    const edit = blankEdit({ duration: 6 });
    const { edit: parsed, rejected } = parseEditReport({
      ...edit,
      clips: [fullClip("clip-1", 0, 5), ...edit.clips],
      layers: [
        {
          instanceId: "a",
          deviceId: "d",
          colorId: "c",
          frame: true,
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          hidden: false,
        },
      ],
      zooms: [{ id: "z", start: 0, end: 2, scale: 2, focus: null }],
    });
    expect(parsed?.clips.map((c) => c.kind)).toEqual(["slide"]);
    expect(rejected).toEqual([
      {
        path: "clips clip-1",
        reason: "a recording clip needs a recording; this montage has none",
      },
    ]);
    expect(parsed?.layers).toEqual([]);
    expect(parsed?.zooms).toEqual([]);

    const only = parseEditState({ ...edit, clips: [fullClip()] });
    expect(only?.clips).toHaveLength(1);
    expect(only?.clips[0].kind).toBe("slide");
  });

  it("ends with its last card, layer or sound", () => {
    const edit = blankEdit({ duration: 10 });
    expect(montageEnd(edit)).toBe(10);
    const longer = {
      ...edit,
      overlays: [
        {
          id: "t",
          kind: "text" as const,
          lane: 0,
          start: 8,
          duration: 6,
          x: 0.5,
          y: 0.5,
          width: 0.5,
          height: 0.2,
          rotation: 0,
          opacity: 1,
          enter: "fade" as const,
          exit: "fade" as const,
          motion: 0.4,
          text: "Hi",
          style: {
            font: "Inter",
            size: 0.1,
            weight: 700,
            color: "#ffffff",
            align: "center" as const,
            background: null,
          },
        },
      ],
      audio: [
        {
          id: "a",
          lane: 0,
          start: 2,
          duration: 20,
          asset: "song",
          in: 0,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    };
    expect(montageEnd(longer)).toBe(22);
    // A recording's montage still ends with its main track.
    expect(montageEnd({ ...longer, source: undefined })).toBe(10);
  });
});
