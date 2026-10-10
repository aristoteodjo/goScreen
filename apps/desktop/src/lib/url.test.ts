import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("adds http for local hosts and https otherwise", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeUrl("192.168.1.4:5173/app")).toBe(
      "http://192.168.1.4:5173/app",
    );
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects empty and non-web schemes", () => {
    expect(normalizeUrl("  ")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });
});
