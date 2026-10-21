// The skill's reference montages (skills/goscreen/references) are the
// quality bar an AI aims for: they must open as they are written.
import { describe, expect, it } from "vitest";
import ad from "../../../skills/goscreen/references/ad-9x16.edit.json";
import launch from "../../../skills/goscreen/references/launch-16x9.edit.json";
import proof from "../../../skills/goscreen/references/proof-1x1.edit.json";
import { parseEditState } from "./schema";

const references = [
  { name: "ad-9x16", json: ad, aspect: "9:16", clips: 5, overlays: 5 },
  { name: "launch-16x9", json: launch, aspect: "16:9", clips: 8, overlays: 14 },
  { name: "proof-1x1", json: proof, aspect: "1:1", clips: 5, overlays: 9 },
];

describe("reference montages", () => {
  for (const r of references) {
    it(`${r.name} parses without losing a field`, () => {
      const edit = parseEditState(r.json);
      expect(edit).not.toBeNull();
      if (!edit) return;
      expect(edit.aspect).toBe(r.aspect);
      // Lenient lists drop a bad item alone: every clip and layer must survive.
      expect(edit.clips).toHaveLength(r.clips);
      expect(edit.overlays).toHaveLength(r.overlays);
      expect(edit.clips[0].id).toBe("intro");
      expect(edit.clips.at(-1)?.id).toBe("outro");
      expect(edit.film?.settings.aspect).toBe(r.aspect);
      expect(edit.layers).toBeNull();
      // Field-by-field fallbacks would silently change the look: check a few.
      expect(edit.background).toEqual(r.json.background);
      expect(edit.screen).toEqual(r.json.screen);
      expect(edit.touch).toEqual(r.json.touch);
      for (const o of edit.overlays)
        expect(o).toEqual(r.json.overlays.find((x) => x.id === o.id));
    });
  }
});
