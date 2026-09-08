import { OVERLAY_FONTS } from "@nodaro/shared"

let injected = false

/**
 * Registers an @font-face for every bundled overlay font, pointing at the
 * backend's /v1/fonts route (same-origin through the proxy). Called once by
 * the preview so text layers render with the exact face the worker uses.
 */
export function ensureOverlayFonts(): void {
  if (injected || typeof document === "undefined") return
  injected = true
  const css = OVERLAY_FONTS.map(
    (f) =>
      `@font-face{font-family:"${f.family}";src:url("/v1/fonts/${f.file}") format("truetype");font-weight:${f.variable ? "100 900" : "400"};font-display:swap;}`,
  ).join("\n")
  const style = document.createElement("style")
  style.setAttribute("data-overlay-fonts", "")
  style.textContent = css
  document.head.appendChild(style)
}

/** CSS font-family stack for a registered font id. */
export function overlayFontFamily(fontId: string): string {
  const f = OVERLAY_FONTS.find((x) => x.id === fontId) ?? OVERLAY_FONTS[0]
  return `"${f.family}", ${f.category === "serif" ? "serif" : f.category === "script" ? "cursive" : "sans-serif"}`
}
