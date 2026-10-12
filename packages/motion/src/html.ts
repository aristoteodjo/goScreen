import { PAGE_SCRIPT } from "./page.ts";
import type { MotionSpec } from "./schema.ts";

/** Where the renderer (compose.mjs) serves the files of a reference. */
export const ASSET_BASE = "http://goscreen.assets/";

/**
 * A spec as one HTML page: every moving part is a Web Animation, paused at 0,
 * so compose.mjs (or a preview) draws any frame by seeking. Text goes in
 * through `textContent`; the only files it loads are its visuals, by name,
 * from `assets` (the reference's folder, as compose.mjs serves it).
 */
export function specHtml(spec: MotionSpec, { assets = ASSET_BASE } = {}): string {
  // `<` escaped so no text can close the script element.
  const json = JSON.stringify(spec).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${spec.width}px;height:${spec.height}px;overflow:hidden;background:#000;-webkit-font-smoothing:antialiased}
#film,.shot{position:absolute;inset:0;overflow:hidden}
.text{position:absolute;font-family:${spec.fonts.text};letter-spacing:-0.02em;white-space:nowrap}
.line{display:block}
.word{display:inline-block;position:relative;transform-origin:50% 100%}
.probe{display:inline-block;width:0;height:0;vertical-align:baseline}
.kicker{font-family:${spec.fonts.mono};font-weight:500;letter-spacing:0.18em;text-transform:uppercase;opacity:.55;line-height:1}
.strike{position:absolute;left:-0.04em;right:-0.04em;top:52%;height:0.07em;border-radius:0.04em;transform-origin:0 50%}
.echo{position:absolute;left:0;top:0;pointer-events:none}
.underline{position:absolute;border-radius:99px}
.label{position:absolute;font-family:${spec.fonts.text};letter-spacing:-0.02em;white-space:nowrap;line-height:1}
.visual{position:absolute;transform-origin:50% 50%}
.media{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:fill}
.cover{position:absolute}
.placeholder{position:absolute;inset:auto 0 6% 0;text-align:center;font:500 ${Math.round(spec.height * 0.018)}px ${spec.fonts.mono};letter-spacing:.15em;text-transform:uppercase;color:#8a94a6;opacity:.6}
</style></head><body><div id="film" data-assets="${assets.replace(/[^A-Za-z0-9:/._~%-]/g, "")}"></div>
<script type="application/json" id="spec">${json}</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}
