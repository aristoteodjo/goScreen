import { describe, expect, it } from "vitest";
import { CATCH_UP, followMove, SETTLE_MS } from "./drift";

const playing = {
  playing: true,
  target: 10,
  current: 10,
  seeking: false,
  msSinceSeek: 10_000,
  seekLatency: 0.4,
  rate: 1,
};

describe("followMove", () => {
  it("lands exactly on the playhead while paused", () => {
    expect(followMove({ ...playing, playing: false, current: 9.95 })).toEqual({
      seekTo: 10,
      rate: 1,
    });
    expect(followMove({ ...playing, playing: false }).seekTo).toBeNull();
  });

  it("leaves an element in sync alone", () => {
    expect(followMove({ ...playing, current: 9.98 })).toEqual({
      seekTo: null,
      rate: 1,
    });
  });

  it("catches up a small drift by speed, never by a seek", () => {
    const behind = followMove({ ...playing, current: 9.8 });
    expect(behind.seekTo).toBeNull();
    expect(behind.rate).toBeCloseTo(1.1);
    const ahead = followMove({ ...playing, current: 10.1, rate: 2 });
    expect(ahead.seekTo).toBeNull();
    expect(ahead.rate).toBeCloseTo(1.9);
  });

  it("seeks a far element ahead by what its seeks take", () => {
    const move = followMove({ ...playing, current: 10 - CATCH_UP - 1 });
    expect(move.seekTo).toBeCloseTo(10.4);
    expect(
      followMove({ ...playing, current: 0, seekLatency: 9, rate: 2 }).seekTo,
    ).toBeCloseTo(13);
  });

  it("never seeks again while the last seek is still starting up", () => {
    const far = { ...playing, current: 2 };
    expect(followMove({ ...far, seeking: true }).seekTo).toBeNull();
    expect(
      followMove({ ...far, msSinceSeek: SETTLE_MS - 1 }).seekTo,
    ).toBeNull();
    expect(
      followMove({ ...far, msSinceSeek: SETTLE_MS }).seekTo,
    ).not.toBeNull();
  });
});
