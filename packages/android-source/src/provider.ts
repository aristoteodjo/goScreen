import type {
  ContentSourceRef,
  DeviceContentSource,
  FrameSource,
  Orientation,
  Resolution,
} from "@goscreen/content-source";
import { z } from "zod";
import { AndroidSourceError, toAndroidError } from "./errors";
import {
  type AdbStatus,
  type AndroidDevice,
  type AndroidInput,
  adbStatusSchema,
  androidDeviceSchema,
  type CaptureSession,
  captureSessionSchema,
} from "./model";

/** Native call transport (Tauri `invoke` in the app, a fake in tests). */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface AndroidDeviceProvider {
  status(): Promise<AdbStatus>;
  isAvailable(): Promise<boolean>;
  listDevices(): Promise<AndroidDevice[]>;
  getDeviceInfo(serial: string): Promise<AndroidDevice>;
  startCapture(serial: string): Promise<CaptureSession>;
  stopCapture(sessionId: string): Promise<void>;
  input(serial: string, action: AndroidInput): Promise<void>;
}

// Rejected before any native call; Rust validates again.
const SERIAL = /^[A-Za-z0-9._:-]{1,128}$/;

function checkSerial(serial: string) {
  if (!SERIAL.test(serial)) throw new AndroidSourceError("invalid_input", `bad serial: ${serial}`);
}

/**
 * ADB-backed provider. Every ADB process runs in Rust; this layer validates
 * what comes back and turns failures into readable errors.
 */
export function createAdbProvider(invoke: Invoke, adbPath: () => string | null): AndroidDeviceProvider {
  const call = async <T>(schema: z.ZodType<T>, command: string, args: Record<string, unknown> = {}) => {
    try {
      return schema.parse(await invoke(command, { adbPath: adbPath(), ...args }));
    } catch (e) {
      throw toAndroidError(e);
    }
  };

  return {
    status: () => call(adbStatusSchema, "android_status"),
    isAvailable: async () => (await call(adbStatusSchema, "android_status")).available,
    listDevices: () => call(z.array(androidDeviceSchema), "android_devices"),
    getDeviceInfo: (serial) => {
      checkSerial(serial);
      return call(androidDeviceSchema, "android_device_info", { serial });
    },
    startCapture: (serial) => {
      checkSerial(serial);
      return call(captureSessionSchema, "android_stream_open", { serial });
    },
    stopCapture: async (sessionId) => {
      await call(z.null(), "android_stream_close", { sessionId });
    },
    input: async (serial, action) => {
      checkSerial(serial);
      await call(z.null(), "android_input", { serial, action });
    },
  };
}

/** One Android device as a content source for a frame. */
export class AndroidContentSource implements DeviceContentSource {
  readonly ref: ContentSourceRef;
  private session: CaptureSession | null = null;

  constructor(
    private readonly provider: AndroidDeviceProvider,
    readonly serial: string,
  ) {
    this.ref = { kind: "android", serial };
  }

  async connect() {
    if (!this.session) this.session = await this.provider.startCapture(this.serial);
  }

  async disconnect() {
    const s = this.session;
    this.session = null;
    if (s) await this.provider.stopCapture(s.sessionId);
  }

  async getResolution(): Promise<Resolution> {
    const info = await this.provider.getDeviceInfo(this.serial);
    if (!info.resolution) throw new AndroidSourceError(info.state === "device" ? "unknown" : info.state, "no resolution");
    return { ...info.resolution, density: info.density };
  }

  async getOrientation(): Promise<Orientation> {
    return (await this.provider.getDeviceInfo(this.serial)).orientation;
  }

  // The device frame is captured with the stage, like a web page.
  async startCapture() {}
  async stopCapture() {}

  getFrameSource(): FrameSource {
    if (!this.session) throw new AndroidSourceError("disconnected", "connect() first");
    return { kind: "mjpeg", url: this.session.url };
  }
}
