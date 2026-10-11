import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, parseEditState } from "./index";

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
