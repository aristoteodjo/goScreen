import { describe, expect, it } from "vitest";
import { DRIFT, SETTLE_MS, shouldSeek } from "./drift";

const settled = { playing: true, seeking: false, msSinceSeek: 10_000 };

describe("shouldSeek", () => {
  it("lands exactly on the playhead while paused", () => {
    expect(
      shouldSeek({
        playing: false,
        drift: 0.05,
        seeking: false,
        msSinceSeek: 0,
      }),
    ).toBe(true);
    expect(
      shouldSeek({ playing: false, drift: 0, seeking: false, msSinceSeek: 0 }),
    ).toBe(false);
  });

  it("lets a playing element run through small drift", () => {
    expect(shouldSeek({ ...settled, drift: DRIFT - 0.01 })).toBe(false);
    expect(shouldSeek({ ...settled, drift: DRIFT + 0.01 })).toBe(true);
  });

  it("never seeks again while the last seek is still starting up", () => {
    expect(shouldSeek({ ...settled, drift: 2, seeking: true })).toBe(false);
    expect(
      shouldSeek({ ...settled, drift: 2, msSinceSeek: SETTLE_MS - 1 }),
    ).toBe(false);
    expect(shouldSeek({ ...settled, drift: 2, msSinceSeek: SETTLE_MS })).toBe(
      true,
    );
  });
});
