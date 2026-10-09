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

  // The page runs on 127.0.0.1, so APIs that only allow the real site's
  // origin (CORS) would refuse it. Calls to another origin go through the
  // proxy's relay, which replays them as the real site; absolute calls to
  // the site itself stay on this listener.
  const routed = (raw) => {
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (url.origin === location.origin) return null;
      if (url.origin === CFG.origin) return CFG.proxyOrigin + url.pathname + url.search + url.hash;
      return `${CFG.proxyOrigin}/__goscreen/relay?u=${encodeURIComponent(url.href)}`;
    } catch {
      return null;
    }
  };
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const to = raw ? routed(raw) : null;
    if (!to) return nativeFetch.call(this, input, init);
    return nativeFetch.call(this, input instanceof Request ? new Request(to, input) : to, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return nativeOpen.call(this, method, routed(String(url)) ?? url, ...rest);
  };

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

  // Only navigations that follow real input are mirrored to synced devices;
  // load-time redirects (m.site.com vs www) would otherwise ping-pong.
  let lastInput = 0;
  const markInput = () => {
    lastInput = Date.now();
  };
  addEventListener("pointerdown", markInput, true);
  addEventListener("keydown", markInput, true);
  const userDriven = () => Date.now() - lastInput < 1500;

  // Bubble phase: SPA routers have already called preventDefault by now, so
  // only plain document navigations are taken over.
  addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (!/^https?:$/.test(url.protocol)) return;
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    const href = url.origin === location.origin ? url.href.replace(CFG.proxyOrigin, CFG.origin) : url.href;
    post({ type: "navigate", href });
  });

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

  const reportLocation = (cause) =>
    post({ type: "location", href: realHref(), title: document.title, cause, user: userDriven() });
  for (const fn of ["pushState", "replaceState"]) {
    const original = history[fn];
    history[fn] = function (...args) {
      const r = original.apply(this, args);
      reportLocation("history");
      return r;
    };
  }
  addEventListener("popstate", () => reportLocation("history"));
  addEventListener("hashchange", () => reportLocation("history"));
  addEventListener("DOMContentLoaded", () => reportLocation("load"));

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
