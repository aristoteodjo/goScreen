import { frameSizeOf, useProject } from "@/modules/studio/store/project";
import { boundsOf, fitView, stepZoom, type View, zoomAt } from "./math";
import { useCanvasView } from "./view";

// Room above each frame for its label row, in canvas units at 100%.
const LABEL_SPACE = 48;

let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;

export function attachCanvas(h: HTMLElement | null, l: HTMLElement | null) {
  host = h;
  layer = l;
}

/** The visible canvas viewport, for recording it. */
export function canvasElement(): HTMLElement | null {
  return host;
}

// Discrete jumps ease in; continuous gestures stay instant.
function animateTo(view: View) {
  if (layer) {
    layer.dataset.animating = "true";
    window.setTimeout(() => {
      if (layer) delete layer.dataset.animating;
    }, 240);
  }
  useCanvasView.getState().setView(view);
}

function center() {
  const r = host?.getBoundingClientRect();
  return r ? { x: r.width / 2, y: r.height / 2 } : { x: 0, y: 0 };
}

export const canvasCommands = {
  /** Frames every device; a small padding packs them tight (for a take). */
  fit(padding = 64) {
    const r = host?.getBoundingClientRect();
    const { devices, canvas } = useProject.getState();
    const rects = devices.flatMap((d) => {
      const p = canvas[d.id];
      if (!p) return [];
      const f = frameSizeOf(d);
      // Laptop bases and monitor stands hang below the frame.
      return [
        {
          x: p.x,
          y: p.y - LABEL_SPACE,
          width: f.width,
          height: f.height + LABEL_SPACE + f.width * 0.14,
        },
      ];
    });
    const bounds = boundsOf(rects);
    if (!r || !bounds) return;
    animateTo(fitView(bounds, r, padding));
  },
  zoomBy(direction: 1 | -1) {
    const v = useCanvasView.getState();
    const c = center();
    animateTo(zoomAt(v, stepZoom(v.zoom, direction), c.x, c.y));
  },
  reset() {
    const v = useCanvasView.getState();
    const c = center();
    animateTo(zoomAt(v, 1, c.x, c.y));
  },
  focus(id: string) {
    const r = host?.getBoundingClientRect();
    const d = useProject.getState().devices.find((x) => x.id === id);
    const p = d ? useProject.getState().canvas[id] : undefined;
    if (!r || !d || !p) return;
    const f = frameSizeOf(d);
    animateTo(
      fitView(
        {
          x: p.x,
          y: p.y - LABEL_SPACE,
          width: f.width,
          height: f.height + LABEL_SPACE,
        },
        r,
        96,
      ),
    );
  },
};
