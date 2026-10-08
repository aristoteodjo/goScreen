import { describe, expect, it } from "vitest";
import {
  type AndroidDevice,
  AndroidContentSource,
  AndroidSourceError,
  createAdbProvider,
  describeAndroidError,
  gestureFrom,
  type ProfileCandidate,
  suggestProfile,
  toAndroidError,
} from "./index";

const emulator: AndroidDevice = {
  id: "emulator-5554",
  serial: "emulator-5554",
  name: "Pixel 10 API 36",
  model: "sdk_gphone64_arm64",
  manufacturer: "Google",
  platform: "emulator",
  androidVersion: "16",
  state: "device",
  resolution: { width: 1080, height: 2424 },
  density: 420,
  orientation: "portrait",
  connected: true,
};

const profiles: ProfileCandidate[] = [
  { id: "iphone-17-pro", brand: "Apple", category: "phone", platform: "ios", viewport: { width: 402, height: 874 } },
  { id: "galaxy-s25-ultra", brand: "Samsung", category: "phone", platform: "android", viewport: { width: 412, height: 891 } },
  { id: "pixel-9a", brand: "Google", category: "phone", platform: "android", viewport: { width: 412, height: 915 } },
  { id: "pixel-10-pro", brand: "Google", category: "phone", platform: "android", viewport: { width: 410, height: 914 } },
  { id: "galaxy-tab-s10", brand: "Samsung", category: "tablet", platform: "android", viewport: { width: 800, height: 1280 } },
];

describe("profile", () => {
  it("picks a Google phone for a Pixel emulator", () => {
    expect(suggestProfile(emulator, profiles)).toMatch(/^pixel-/);
  });

  it("picks a tablet for a wide screen", () => {
    const tablet = { ...emulator, model: "SM-X820", manufacturer: "samsung", resolution: { width: 1600, height: 2560 }, density: 320 };
    expect(suggestProfile(tablet, profiles)).toBe("galaxy-tab-s10");
  });
});

describe("gestures", () => {
  const el = { width: 400, height: 800 };
  const native = { width: 1080, height: 2160 };

  it("maps a short still press to a tap in device pixels", () => {
    expect(gestureFrom({ x: 200, y: 400, t: 0 }, { x: 202, y: 401, t: 90 }, el, native)).toEqual({
      kind: "tap",
      x: 540,
      y: 1080,
    });
  });

  it("maps a long still press to a zero-length swipe", () => {
    const g = gestureFrom({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 800 }, el, native);
    expect(g).toMatchObject({ kind: "swipe", durationMs: 800 });
  });

  it("maps travel to a swipe and clamps to the screen", () => {
    const g = gestureFrom({ x: 200, y: 700, t: 0 }, { x: 200, y: 900, t: 200 }, el, native);
    expect(g).toEqual({ kind: "swipe", x1: 540, y1: 1890, x2: 540, y2: 2159, durationMs: 200 });
  });
});

describe("provider", () => {
  it("validates native results and passes the configured adb path", async () => {
    const calls: unknown[] = [];
    const provider = createAdbProvider(async (cmd, args) => {
      calls.push([cmd, args]);
      return [emulator];
    }, () => "/custom/adb");
    expect(await provider.listDevices()).toEqual([emulator]);
    expect(calls).toEqual([["android_devices", { adbPath: "/custom/adb" }]]);
  });

  it("turns native failures into readable errors", async () => {
    const provider = createAdbProvider(async () => {
      throw { code: "unauthorized", detail: "device unauthorized" };
    }, () => null);
    await expect(provider.listDevices()).rejects.toMatchObject({ code: "unauthorized" });
    expect(toAndroidError("adb exited with code 1").message).toBe(describeAndroidError("unknown").title);
  });

  it("refuses malformed serials before any native call", async () => {
    const provider = createAdbProvider(async () => null, () => null);
    await expect(provider.input("x; rm -rf /", { kind: "key", key: "home" })).rejects.toBeInstanceOf(AndroidSourceError);
  });

  it("exposes a connected source as an MJPEG frame source", async () => {
    const provider = createAdbProvider(async (cmd) => {
      if (cmd === "android_stream_open") return { sessionId: "s1", url: "http://127.0.0.1:5000/stream/s1" };
      return null;
    }, () => null);
    const source = new AndroidContentSource(provider, "emulator-5554");
    expect(() => source.getFrameSource()).toThrow();
    await source.connect();
    expect(source.getFrameSource()).toEqual({ kind: "mjpeg", url: "http://127.0.0.1:5000/stream/s1" });
  });
});
