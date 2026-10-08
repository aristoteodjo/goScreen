import { describe, expect, it } from "vitest";
import { builtinPack } from "./builtin";
import { createRegistry, parseDevicePack } from "./registry";

describe("device registry", () => {
  it("loads the builtin pack with unique ids", () => {
    const ids = builtinPack.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("iphone-17-pro");
    expect(ids).toContain("pixel-10");
  });

  it("lets a later pack override a builtin device", () => {
    const custom = parseDevicePack({
      metadata: { id: "custom", name: "Custom", version: "1", builtin: false },
      devices: [{ ...builtinPack.devices[0], name: "Renamed" }],
    });
    const registry = createRegistry([builtinPack, custom]);
    expect(registry.get(builtinPack.devices[0].id)?.name).toBe("Renamed");
    expect(registry.list()).toHaveLength(builtinPack.devices.length);
  });

  it("rejects an invalid definition", () => {
    expect(() =>
      parseDevicePack({
        metadata: { id: "bad", name: "Bad", version: "1", builtin: false },
        devices: [{ id: "Not Valid" }],
      }),
    ).toThrow();
  });
});
