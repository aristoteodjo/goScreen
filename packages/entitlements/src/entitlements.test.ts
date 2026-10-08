import { describe, expect, it } from "vitest";
import { canCreateProject, canExport4K, canExportResolution, entitlementsFor } from "./index";

describe("entitlements", () => {
  it("caps free exports at 720p and three projects", () => {
    const free = entitlementsFor("free");
    expect(canExportResolution(free, "720p")).toBe(true);
    expect(canExportResolution(free, "1080p")).toBe(false);
    expect(canCreateProject(free, 2)).toBe(true);
    expect(canCreateProject(free, 3)).toBe(false);
  });

  it("gives the trial the same rights as pro", () => {
    expect(entitlementsFor("trial")).toEqual(entitlementsFor("pro"));
    expect(canExport4K(entitlementsFor("trial"))).toBe(true);
    expect(canCreateProject(entitlementsFor("pro"), 10_000)).toBe(true);
  });
});
