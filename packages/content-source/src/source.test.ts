import { describe, expect, it } from "vitest";
import { sameSource, sourceKey, viewportFor, WEB_SOURCE } from "./index";

describe("content sources", () => {
  it("keys sources by kind and serial", () => {
    expect(sourceKey(WEB_SOURCE)).toBe("web");
    expect(sameSource({ kind: "android", serial: "emulator-5554" }, { kind: "android", serial: "emulator-5554" })).toBe(
      true,
    );
  });

  it("derives a portrait CSS viewport from native pixels and dpi", () => {
    expect(viewportFor({ width: 2424, height: 1080, density: 420 })).toEqual({ width: 411, height: 923 });
    expect(viewportFor({ width: 400, height: 800, density: null })).toEqual({ width: 400, height: 800 });
  });
});
