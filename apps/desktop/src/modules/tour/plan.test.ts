import { describe, expect, it } from "vitest";
import { DEFAULT_TOUR, pageLabel, samePage, scrollRatioAt, tourSeconds } from "./plan";

describe("site tour plan", () => {
  it("eases the scroll from top to bottom", () => {
    expect(scrollRatioAt(0, 6)).toBe(0);
    expect(scrollRatioAt(3, 6)).toBeCloseTo(0.5);
    expect(scrollRatioAt(1, 6)).toBeLessThan(1 / 6);
    expect(scrollRatioAt(9, 6)).toBe(1);
  });

  it("estimates the video length", () => {
    expect(tourSeconds(3, DEFAULT_TOUR)).toBe(27);
  });

  it("compares pages without trailing slash or hash", () => {
    expect(samePage("https://a.app/offres/", "https://a.app/offres#x")).toBe(true);
    expect(samePage("https://a.app/", "https://a.app")).toBe(true);
    expect(samePage("https://a.app/a?x=1", "https://a.app/a")).toBe(false);
    expect(pageLabel("https://a.app/packs/mois")).toBe("/packs/mois");
  });
});
