import { z } from "zod";

// An Android instance reachable through ADB. Distinct from a Device Registry
// definition: `emulator-5554` is a running device, `pixel-10-pro` is a look.
export const androidDeviceSchema = z.object({
  id: z.string().min(1),
  serial: z.string().min(1),
  name: z.string(),
  model: z.string().nullable(),
  manufacturer: z.string().nullable(),
  platform: z.enum(["emulator", "physical"]),
  androidVersion: z.string().nullable(),
  // ADB state: only "device" can be queried, streamed and driven.
  state: z.enum(["device", "unauthorized", "offline", "unknown"]),
  resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
  density: z.number().positive().nullable(),
  orientation: z.enum(["portrait", "landscape"]),
  connected: z.boolean(),
});

export type AndroidDevice = z.infer<typeof androidDeviceSchema>;

export const adbStatusSchema = z.object({
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
});

export type AdbStatus = z.infer<typeof adbStatusSchema>;

export const captureSessionSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url(),
});

export type CaptureSession = z.infer<typeof captureSessionSchema>;

export type AndroidKey = "back" | "home" | "recents";

/** Input in native device pixels. */
export type AndroidInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | { kind: "key"; key: AndroidKey };
