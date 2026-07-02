import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Each renderer contributes RTL support differently — the expected token is
// explicit per file so this guard stays honest about what each renderer
// actually does, rather than one blanket `directionStyle` check.
const RTL_TOKEN_BY_RENDERER: Record<string, string> = {
  // Renders text directly, so it calls directionStyle itself.
  "motion-graphics-renderer": "directionStyle",
  // Delegates text (and direction) to SceneTextSegment; this renderer's own
  // contribution is only the RTL-safe font-family fallback stack.
  "after-effects-renderer": "withRtlFallback",
}

describe("MG + AE renderers are RTL-wired", () => {
  it.each(Object.entries(RTL_TOKEN_BY_RENDERER))("%s contributes RTL support", (name, token) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain(token)
  })
})

describe("3D title renderer documents its best-effort RTL limitation", () => {
  // WebGL builds glyph geometry directly from a bundled typeface.json path
  // (resolve3DFontPath), never a CSS font-family string, so `withRtlFallback`
  // (a CSS font-family stack helper) has no application point here. Instead
  // this renderer must carry the documented best-effort bidi limitation
  // above its text-mesh dispatch — assert that instead of a vacuous
  // `withRtlFallback` string check.
  it("three-d-title-renderer contains the documented bidi limitation", () => {
    const src = readFileSync(join(__dirname, "..", "three-d-title-renderer.tsx"), "utf8")
    expect(src).toContain("best-effort")
    expect(src).toContain("bidi")
  })
})
