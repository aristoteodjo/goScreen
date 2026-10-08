import { z } from "zod";

export const ANDROID_ERROR_CODES = [
  "adb_missing",
  "adb_invalid_path",
  "no_device",
  "unauthorized",
  "offline",
  "disconnected",
  "timeout",
  "unsupported",
  "ffmpeg_missing",
  "invalid_input",
  "unknown",
] as const;

export type AndroidErrorCode = (typeof ANDROID_ERROR_CODES)[number];

const rustErrorSchema = z.object({ code: z.enum(ANDROID_ERROR_CODES), detail: z.string() });

export class AndroidSourceError extends Error {
  constructor(
    readonly code: AndroidErrorCode,
    readonly detail: string,
  ) {
    super(describeAndroidError(code).title);
    this.name = "AndroidSourceError";
  }
}

/** Turns whatever a native call rejected with into a typed error. */
export function toAndroidError(e: unknown): AndroidSourceError {
  if (e instanceof AndroidSourceError) return e;
  const parsed = rustErrorSchema.safeParse(e);
  if (parsed.success) return new AndroidSourceError(parsed.data.code, parsed.data.detail);
  return new AndroidSourceError("unknown", e instanceof Error ? e.message : String(e));
}

const CHECKLIST = [
  "the emulator is running",
  "ADB is available",
  "the device is authorized",
  "the device is still connected",
];

/** What the user reads. Never a raw "adb exited with code 1". */
export function describeAndroidError(code: AndroidErrorCode): { title: string; hints: string[] } {
  switch (code) {
    case "adb_missing":
      return {
        title: "ADB was not found.",
        hints: [
          "Install Android SDK Platform Tools (Android Studio installs them).",
          "Or set the path to adb in Android settings.",
        ],
      };
    case "adb_invalid_path":
      return { title: "The configured ADB path is not an adb executable.", hints: ["Check the path in Android settings."] };
    case "no_device":
      return { title: "No Android device is connected.", hints: ["Start an emulator, or plug in a device with USB debugging on."] };
    case "unauthorized":
      return {
        title: "The device has not authorized this computer.",
        hints: ["Unlock the device and accept the USB debugging prompt."],
      };
    case "offline":
      return { title: "The device is offline.", hints: ["Restart the emulator, or reconnect the USB cable."] };
    case "disconnected":
      return { title: "The Android device disconnected.", hints: ["Check that the emulator is still running.", "Check the USB cable."] };
    case "timeout":
      return { title: "The device did not answer in time.", hints: ["It may be busy or locked. Unlock it and retry."] };
    case "unsupported":
      return { title: "This Android version cannot stream its screen.", hints: ["Android 5.0 (API 21) or later is required."] };
    case "ffmpeg_missing":
      return { title: "FFmpeg is required to show the Android screen.", hints: ["Install it with: brew install ffmpeg"] };
    case "invalid_input":
      return { title: "That request was rejected before reaching the device.", hints: [] };
    case "unknown":
      return { title: "Could not connect to the Android device.", hints: CHECKLIST };
  }
}
