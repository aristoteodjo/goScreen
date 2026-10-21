import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, parseEditReport, parseEditState } from "./index";

describe("parseEditReport", () => {
  it("names every item the lenient parse left out", () => {
    const { edit, rejected } = parseEditReport({
      ...DEFAULT_EDIT,
      version: 2,
      clips: [
        {
          id: "ok",
          kind: "recording",
          transition: null,
          in: 0,
          out: 5,
          speed: 1,
        },
        {
          id: "bad",
          kind: "recording",
          transition: null,
          in: 0,
          out: -1,
          speed: 1,
        },
      ],
      overlays: [
        {
          id: "img",
          kind: "image",
          lane: 0,
          start: 0,
          duration: 1,
          x: 0.5,
          y: 0.5,
          width: 0.3,
          height: 0.3,
          enter: "fade",
          exit: "fade",
          asset: "missing",
          radius: 0,
        },
      ],
      audio: [{ id: "a", lane: 0 }],
    });
    expect(edit?.clips.map((c) => c.id)).toEqual(["ok"]);
    expect(edit?.overlays).toEqual([]);
    expect(rejected.map((r) => r.path)).toEqual([
      "clips.1",
      "audio.0",
      "overlays img",
    ]);
    expect(rejected[0].reason).toContain("out");
    expect(rejected[2].reason).toContain("missing");
  });

  it("says why a whole edit cannot be read", () => {
    const { edit, rejected } = parseEditReport({ version: 7 });
    expect(edit).toBeNull();
    expect(rejected[0].path).toBe("version");
  });
});

describe("showcase fields", () => {
  it("keep decor discs, brand cards and kicker styles; drop broken ones alone", () => {
    const edit = parseEditState({
      ...DEFAULT_EDIT,
      version: 2,
      background: {
        kind: "color",
        value: "#f7f7f2",
        decor: [{ x: 0.94, y: 0.36, r: 0.3, color: "#e9a100", opacity: 0.16 }],
      },
      clips: [
        {
          id: "intro",
          kind: "slide",
          transition: null,
          duration: 3,
          background: { kind: "color", value: "#f7f7f2" },
          title: "Trouvez. *Recevez.*",
          subtitle: "",
          color: "#16241c",
          font: "Inter",
          animation: "words",
          layout: "left",
          brand: "OEUF D'OR",
          accent: "not a colour",
        },
      ],
    });
    expect(edit?.background).toMatchObject({ decor: [{ r: 0.3 }] });
    const intro = edit?.clips[0];
    expect(intro?.kind === "slide" && intro.layout).toBe("left");
    expect(intro?.kind === "slide" && intro.brand).toBe("OEUF D'OR");
    expect(intro?.kind === "slide" && intro.accent).toBeUndefined();
  });
});
