import { ZOOM_IN, ZOOM_RAMP } from "@goscreen/render-engine";
import { describe, expect, it } from "vitest";
import { eyesAt, faceTimes, faceZooms } from "./facezooms";

const eyes = [
  { t: 0.1, u: 0.48, v: 0.38 },
  { t: 4.1, u: 0.52, v: 0.4 },
  { t: 8.1, u: 0.5, v: 0.36 },
];

describe("faceZooms", () => {
  it("alternates wide and close at every cut, close centred on the eyes", () => {
    const zooms = faceZooms([0, 4, 8, 12], eyes);
    // Clips 1 and 3 are wide (no zoom), clip 2 is close.
    expect(zooms).toHaveLength(1);
    expect(zooms[0].scale).toBe(1.2);
    expect(zooms[0].focus).toEqual({ x: 0.52, y: 0.4 });
    expect(zooms[0].id).toBe("face-1");
    // The camera is already close when the cut lands: 0.4 s of push-in shown.
    expect(zooms[0].start).toBeCloseTo(4 - (ZOOM_IN - 0.4));
    expect(zooms[0].end).toBeCloseTo(8 + ZOOM_RAMP);

    const fromClose = faceZooms([0, 4, 8, 12], eyes, { startClose: true });
    expect(fromClose.map((z) => Number(z.start.toFixed(6)))).toEqual([
      0,
      Number((8 - (ZOOM_IN - 0.4)).toFixed(6)),
    ]);
  });

  it("caps the close framing on 1080p sources", () => {
    expect(faceZooms([0, 4, 8], eyes, { sourceHeight: 1080 })[0].scale).toBe(
      1.15,
    );
    expect(faceZooms([0, 4, 8], eyes, { sourceHeight: 2160 })[0].scale).toBe(
      1.2,
    );
    expect(
      faceZooms([0, 4, 8], eyes, {
        close: 1.1,
        cap1080: 1.15,
        sourceHeight: 720,
      })[0].scale,
    ).toBe(1.1);
  });

  it("falls back to the upper centre without eyes and skips empty clips", () => {
    const zooms = faceZooms([0, 4, 4, 8, 12], []);
    expect(zooms).toHaveLength(1);
    expect(zooms[0].focus).toEqual({ x: 0.5, y: 0.4 });
    expect(faceZooms([0, 4, 8], eyes, { close: 1 })).toEqual([]);
  });
});

describe("eyesAt and faceTimes", () => {
  it("takes the nearest sample and one time per clip", () => {
    expect(eyesAt(eyes, 3.9)?.t).toBe(4.1);
    expect(eyesAt([], 1)).toBeNull();
    expect(faceTimes([0, 4, 4.1, 8]).map((t) => Number(t.toFixed(3)))).toEqual([
      0.1, 4.05, 4.2,
    ]);
  });
});
