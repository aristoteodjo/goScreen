(() => {
  const CFG = __GOSCREEN_CONFIG__;
  if (window.__goscreenBridge) return;
  window.__goscreenBridge = true;

  const post = (msg) => window.parent.postMessage({ __goscreen: 1, ...msg }, "*");
  const realHref = () => location.href.replace(CFG.proxyOrigin, CFG.origin);

  try {
    Object.defineProperty(navigator, "userAgent", { get: () => CFG.userAgent });
    if (CFG.touch) Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  } catch {}

  let pending = null;
  const flushPointer = () => {
    if (pending) post(pending);
    pending = null;
  };
  addEventListener(
    "pointermove",
    (e) => {
      if (!pending) requestAnimationFrame(flushPointer);
      pending = { type: "pointer", x: e.clientX, y: e.clientY, t: Date.now() };
    },
    { capture: true, passive: true },
  );
  for (const type of ["pointerdown", "pointerup"]) {
    addEventListener(
      type,
      (e) => post({ type: type === "pointerdown" ? "down" : "up", x: e.clientX, y: e.clientY, t: Date.now() }),
      { capture: true, passive: true },
    );
  }

  addEventListener(
    "click",
    (e) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || e.defaultPrevented || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
      e.preventDefault();
      post({ type: "navigate", href: url.href });
    },
    true,
  );

  let syncing = false;
  let scrollQueued = false;
  const scroller = () => document.scrollingElement || document.documentElement;
  addEventListener(
    "scroll",
    () => {
      if (syncing || scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        const el = scroller();
        const max = Math.max(1, el.scrollHeight - innerHeight);
        post({ type: "scroll", y: scrollY, ratio: scrollY / max, t: Date.now() });
      });
    },
    { capture: true, passive: true },
  );

  const reportLocation = () => post({ type: "location", href: realHref(), title: document.title });
  for (const fn of ["pushState", "replaceState"]) {
    const original = history[fn];
    history[fn] = function (...args) {
      const r = original.apply(this, args);
      reportLocation();
      return r;
    };
  }
  addEventListener("popstate", reportLocation);
  addEventListener("hashchange", reportLocation);
  addEventListener("DOMContentLoaded", reportLocation);

  addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.__goscreen !== 1) return;
    const cmd = e.data;
    if (cmd.type === "scrollTo") {
      syncing = true;
      const max = Math.max(0, scroller().scrollHeight - innerHeight);
      scrollTo({ top: cmd.ratio * max, behavior: "instant" });
      requestAnimationFrame(() => {
        syncing = false;
      });
    } else if (cmd.type === "back") {
      history.back();
    } else if (cmd.type === "forward") {
      history.forward();
    }
  });
})();
