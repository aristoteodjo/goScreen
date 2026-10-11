import { create } from "zustand";
import { cn } from "@/lib/utils";

// The AI's own cursor: when an assistant drives goScreen, a second pointer
// glides to what it is about to change, "clicks", and says what it does,
// so the person can follow along. It never takes the real mouse.

type CursorState = {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  // Bumped on each click: replays the ripple.
  clicks: number;
  name: string;
};

export const useAiCursor = create<CursorState>(() => ({
  visible: false,
  x: 0,
  y: 0,
  label: "",
  clicks: 0,
  name: "AI",
}));

// Follow the AI: its places open in tabs and the cursor shows each step.
type WatchState = { follow: boolean; setFollow: (follow: boolean) => void };
const WATCH_KEY = "goscreen.ai.follow";
export const useAiWatch = create<WatchState>((set) => {
  let follow = true;
  try {
    follow = localStorage.getItem(WATCH_KEY) !== "off";
  } catch {}
  return {
    follow,
    setFollow: (next) => {
      try {
        localStorage.setItem(WATCH_KEY, next ? "on" : "off");
      } catch {}
      set({ follow: next });
    },
  };
});

const GLIDE_MS = 520;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let hideTimer: ReturnType<typeof setTimeout> | undefined;

type Target = string | Element | { x: number; y: number } | null;

// Brings an element into view; a canvas (the flow) pans to it. Returns
// whether it handled the element.
type Revealer = (el: Element) => boolean;
const revealers = new Set<Revealer>();
export function addRevealer(fn: Revealer) {
  revealers.add(fn);
  return () => {
    revealers.delete(fn);
  };
}

function elementOf(target: Target): Element | null {
  if (!target) return null;
  if (typeof target === "string") return document.querySelector(target);
  return target instanceof Element ? target : null;
}

/** The part of the element left visible by the window and clipping ancestors. */
function visibleRect(el: Element) {
  const r = el.getBoundingClientRect();
  let left = Math.max(0, r.left);
  let top = Math.max(0, r.top);
  let right = Math.min(window.innerWidth, r.right);
  let bottom = Math.min(window.innerHeight, r.bottom);
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflowX === "visible" && style.overflowY === "visible")
      continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  return right - left < 4 || bottom - top < 4
    ? null
    : { left, top, width: right - left, height: bottom - top };
}

function resolve(target: Target): { x: number; y: number } | null {
  if (!target) return null;
  if (typeof target === "object" && "x" in target && !("nodeType" in target))
    return target as { x: number; y: number };
  const el = elementOf(target);
  const r = el ? visibleRect(el) : null;
  if (!r) return null;
  // Inside the element, a little up and left of its center: where a hand
  // would land on a button or a block.
  return {
    x: r.left + Math.min(r.width / 2, 120),
    y: r.top + Math.min(r.height / 2, 60),
  };
}

/** Scrolls or pans the first target that exists into view. */
async function reveal(targets: Target[]) {
  const el = targets.map(elementOf).find((e) => e !== null);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const v = visibleRect(el);
  // A small item must be mostly in view; a big panel only needs some of it.
  const seen = v ? v.width * v.height : 0;
  if (seen >= 0.6 * r.width * r.height || seen > 60_000) return;
  for (const fn of revealers) if (fn(el)) return sleep(450);
  el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  await sleep(350);
}

/** Glides to the target (the first selector that matches) and says why. */
export async function aiPoint(
  targets: Target | Target[],
  label: string,
): Promise<boolean> {
  if (!useAiWatch.getState().follow) return false;
  const list = Array.isArray(targets) ? targets : [targets];
  clearTimeout(hideTimer);
  await reveal(list);
  const find = () => list.map(resolve).find((p) => p !== null) ?? null;
  const at = find();
  if (!at) {
    useAiCursor.setState({ label });
    return false;
  }
  if (!useAiCursor.getState().visible)
    // Appears from the window's right edge the first time.
    useAiCursor.setState({
      x: window.innerWidth - 40,
      y: at.y,
      visible: true,
    });
  await sleep(16);
  useAiCursor.setState({ x: at.x, y: at.y, label });
  await sleep(GLIDE_MS);
  // The page may have moved under it (a panel opening, a list scrolling).
  const now = find();
  if (now && Math.hypot(now.x - at.x, now.y - at.y) > 4) {
    useAiCursor.setState({ x: now.x, y: now.y });
    await sleep(GLIDE_MS / 2);
  }
  return true;
}

export async function aiClick() {
  if (!useAiWatch.getState().follow) return;
  useAiCursor.setState((s) => ({ clicks: s.clicks + 1 }));
  await sleep(180);
}

/** The AI is done for now: the cursor fades after a moment. */
export function aiRest(label?: string) {
  if (label) useAiCursor.setState({ label });
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => useAiCursor.setState({ visible: false }), 2600);
}

export function AiCursor() {
  const { visible, x, y, label, clicks, name } = useAiCursor();
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed top-0 left-0 z-[200] transition-[transform,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transitionDuration: `${GLIDE_MS}ms`,
      }}
    >
      <span
        key={clicks}
        className={cn(
          "absolute -top-4 -left-4 size-8 rounded-full border-2 border-orange-400",
          clicks > 0 && "animate-[ai-ripple_0.5s_ease-out_forwards]",
          clicks === 0 && "opacity-0",
        )}
      />
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
      >
        <title>AI cursor</title>
        <path
          d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.6 12.4 Z"
          fill="#f97316"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute top-5 left-4 flex max-w-72 items-center gap-1.5 rounded-full bg-orange-500 py-1 pr-2.5 pl-1 text-[11.5px] font-medium whitespace-nowrap text-white shadow-lg">
        <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-semibold">
          {name}
        </span>
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}
