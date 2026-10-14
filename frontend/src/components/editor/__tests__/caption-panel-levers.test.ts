// @vitest-environment node
import { describe, it, expect } from "vitest"
import { resolveCaptionPanelLevers } from "../caption-panel-levers"
import { CAPTION_LOOKS, DEFAULT_CAPTION_LOOK, DEFAULT_SUBTITLE_LOOK } from "@nodaro/shared"

// Guards that the frontend render-mirror stays faithful to the worker — both go
// through the shared `resolveCaptionLevers`, so the per-style default look
// (kinetic → outline, subtitle → clean) can't drift between panel, preview and
// the burned output.
describe("resolveCaptionPanelLevers", () => {
  const FS = 32

  it("bare subtitle (no look) resolves the plain CLEAN preset — a pinned sans, no outline house-style", () => {
    expect(resolveCaptionPanelLevers("subtitle", undefined, {}, FS)).toEqual(CAPTION_LOOKS[DEFAULT_SUBTITLE_LOOK](FS))
    const out = resolveCaptionPanelLevers("subtitle", undefined, { strokeColor: "#123456" }, FS)
    expect(out.strokeColor).toBe("#123456")
    // a face is always pinned (no browser-default serif) …
    expect(out.fontFamily).toBe("Inter")
    // … but no outline house-style leaks onto a bare subtitle
    expect(out.uppercase).toBeUndefined()
    expect(out.highlightColor).toBeUndefined()
  })

  it("subtitle that NAMES a look resolves that preset", () => {
    const out = resolveCaptionPanelLevers("subtitle", "outline", {}, FS)
    expect(out).toEqual(CAPTION_LOOKS.outline(FS))
    expect(out.uppercase).toBe(true)
  })

  it("a kinetic style with no look resolves the default preset", () => {
    expect(resolveCaptionPanelLevers("word-highlight", undefined, {}, FS)).toEqual(
      CAPTION_LOOKS[DEFAULT_CAPTION_LOOK](FS),
    )
  })

  it("an explicit lever overrides the resolved preset, others keep the preset value", () => {
    const out = resolveCaptionPanelLevers("karaoke", "outline", { uppercase: false, highlightColor: "#abcdef" }, FS)
    expect(out.uppercase).toBe(false)
    expect(out.highlightColor).toBe("#abcdef")
    expect(out.fontFamily).toBe("Montserrat")
  })
})
