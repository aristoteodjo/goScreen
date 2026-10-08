import type { BridgeCommand, BridgeEvent } from "./bridge";

type ScrollEvent = Extract<BridgeEvent, { type: "scroll" }>;

/**
 * Converts a scroll on the source device into the command sent to every
 * other device when "Sync interactions" is on.
 *
 * Devices have different viewport heights, so the same page has a different
 * total height on an iPhone and on an iPad.
 */
export function syncScrollCommand(event: ScrollEvent): BridgeCommand {
  // TODO(you): choose the sync strategy. See the request in the chat.
  return { type: "scrollTo", ratio: event.ratio };
}
