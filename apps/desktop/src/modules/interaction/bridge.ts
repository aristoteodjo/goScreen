import { z } from "zod";

const point = { x: z.number(), y: z.number(), t: z.number() };

export const bridgeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pointer"), ...point }),
  z.object({ type: z.literal("down"), ...point }),
  z.object({ type: z.literal("up"), ...point }),
  z.object({
    type: z.literal("scroll"),
    y: z.number(),
    ratio: z.number(),
    t: z.number(),
  }),
  z.object({ type: z.literal("navigate"), href: z.string().url() }),
  z.object({
    type: z.literal("location"),
    href: z.string(),
    title: z.string(),
  }),
]);

export type BridgeEvent = z.infer<typeof bridgeEventSchema>;

export type BridgeCommand =
  | { type: "scrollTo"; ratio: number }
  | { type: "back" }
  | { type: "forward" };

type Listener = (instanceId: string, event: BridgeEvent) => void;

const PROXY_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/;
const frames = new Map<string, HTMLIFrameElement>();
const listeners = new Set<Listener>();
let attached = false;

function onMessage(e: MessageEvent) {
  if (!PROXY_ORIGIN.test(e.origin)) return;
  if (e.data?.__goscreen !== 1) return;
  let instanceId: string | undefined;
  for (const [id, frame] of frames) {
    if (frame.contentWindow === e.source) {
      instanceId = id;
      break;
    }
  }
  if (!instanceId) return;
  const parsed = bridgeEventSchema.safeParse(e.data);
  if (!parsed.success) return;
  for (const listener of listeners) listener(instanceId, parsed.data);
}

export function registerFrame(id: string, frame: HTMLIFrameElement | null) {
  if (frame) frames.set(id, frame);
  else frames.delete(id);
}

export function sendToFrame(id: string, command: BridgeCommand) {
  frames.get(id)?.contentWindow?.postMessage({ __goscreen: 1, ...command }, "*");
}

export function subscribeBridge(listener: Listener): () => void {
  if (!attached) {
    window.addEventListener("message", onMessage);
    attached = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
