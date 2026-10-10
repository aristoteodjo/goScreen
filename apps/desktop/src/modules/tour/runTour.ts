import { sendToFrame, subscribeBridge } from "@/modules/interaction/bridge";
import { useRecording } from "@/modules/recording/store";
import type { CaptureControls } from "@/modules/recording/useCapture";
import { useProject } from "@/modules/studio/store/project";
import { samePage, scrollRatioAt, type TourOptions } from "./plan";
import { useTour } from "./store";

const LOAD_TIMEOUT_MS = 12_000;
const SETTLE_MS = 700;

class Cancelled extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Web devices that follow the shared URL: the ones a tour drives. */
function tourDevices() {
  return useProject
    .getState()
    .devices.filter((d) => d.source.kind === "web" && d.synced);
}

function guard() {
  // Stopping the recording (toolbar Stop) ends the tour.
  if (!useRecording.getState().active || !useTour.getState().running)
    throw new Cancelled();
}

async function wait(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    guard();
    await sleep(Math.min(100, until - performance.now()));
  }
}

/**
 * Runs `trigger` (a navigation, a view switch) and resolves once every
 * synced device has reported a fresh page load, or after a timeout.
 */
function afterLoads(trigger: () => void): Promise<void> {
  const ids = new Set(tourDevices().map((d) => d.id));
  const loaded = new Set<string>();
  return new Promise<void>((resolve) => {
    const finish = () => {
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = subscribeBridge((id, event) => {
      if (event.type !== "location" || event.cause !== "load" || !ids.has(id))
        return;
      loaded.add(id);
      if (loaded.size >= ids.size) finish();
    });
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS);
    trigger();
  });
}

function scrollAllTo(ratio: number) {
  for (const d of tourDevices()) sendToFrame(d.id, { type: "scrollTo", ratio });
}

/** Points every synced device at `url`, from the top, once loaded. */
async function open(url: string, recording: boolean) {
  if (!samePage(useProject.getState().url, url))
    await afterLoads(() => useProject.getState().setUrl(url));
  scrollAllTo(0);
  if (recording) await wait(SETTLE_MS);
  else await sleep(SETTLE_MS);
}

/** Scrolls every synced device from top to bottom over `seconds`. */
async function scrollThrough(seconds: number) {
  const ids = tourDevices().map((d) => d.id);
  const start = performance.now();
  for (;;) {
    guard();
    const elapsed = (performance.now() - start) / 1000;
    const ratio = scrollRatioAt(elapsed, seconds);
    for (const id of ids) sendToFrame(id, { type: "scrollTo", ratio });
    if (ratio >= 1) return;
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/**
 * Records a whole site: every page in turn, held at the top, scrolled to
 * the bottom, held again. Ends in the editor like any recording.
 */
export async function runTour(
  pages: string[],
  options: TourOptions,
  capture: CaptureControls,
) {
  if (pages.length === 0) throw new Error("Pick at least one page.");
  if (tourDevices().length === 0)
    throw new Error("Add a web device that follows the shared URL.");
  const tour = useTour.getState();
  tour.set({ running: true, index: 0, total: pages.length, page: pages[0] });
  try {
    // The first page loads before the camera rolls; the view stays as picked.
    await open(pages[0], false);
    await capture.startAsync();
    for (const [index, page] of pages.entries()) {
      useTour.getState().set({ index, page });
      useRecording.getState().markChapter(page);
      if (index > 0) await open(page, true);
      await wait(options.pauseSeconds * 1000);
      await scrollThrough(options.scrollSeconds);
      await wait(options.pauseSeconds * 1000);
    }
    if (useRecording.getState().active) await capture.stopAsync();
  } catch (e) {
    if (!(e instanceof Cancelled)) {
      if (useRecording.getState().active)
        await capture.stopAsync().catch(() => {});
      throw e;
    }
  } finally {
    useTour.getState().set({ running: false, page: null });
  }
}
