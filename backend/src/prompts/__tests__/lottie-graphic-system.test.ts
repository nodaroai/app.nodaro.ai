import { describe, it, expect } from "vitest"
import { applySlots } from "@nodaro/shared"
import { LOTTIE_GRAPHIC_SYSTEM_PROMPT } from "../lottie-graphic-system.js"
import { LOTTIE_FONT_SAFELIST, validateLottieGraphic } from "../../lib/lottie-graphic-validator.js"

/** Extract the embedded EXAMPLE OUTPUT JSON block from the prompt. */
function extractExampleJson(): unknown {
  const marker = "EXAMPLE OUTPUT (lower third):"
  const markerIdx = LOTTIE_GRAPHIC_SYSTEM_PROMPT.indexOf(marker)
  const start = LOTTIE_GRAPHIC_SYSTEM_PROMPT.indexOf("{", markerIdx)
  const end = LOTTIE_GRAPHIC_SYSTEM_PROMPT.lastIndexOf("}")
  return JSON.parse(LOTTIE_GRAPHIC_SYSTEM_PROMPT.slice(start, end + 1))
}

const EXPECTED = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
  backgroundColor: "#00000000",
} as const

/** All text-document style objects (`t.d.k[i].s`) across every text layer. */
function textDocStyles(lottie: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const layers = (lottie.layers as Array<Record<string, unknown>>) ?? []
  for (const layer of layers) {
    const t = layer.t as Record<string, unknown> | undefined
    const d = t?.d as Record<string, unknown> | undefined
    const k = d?.k as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(k)) continue
    for (const kf of k) {
      const s = kf.s as Record<string, unknown> | undefined
      if (s) out.push(s)
    }
  }
  return out
}

describe("lottie system prompt", () => {
  it("names every safelisted font", () => {
    for (const f of LOTTIE_FONT_SAFELIST) expect(LOTTIE_GRAPHIC_SYSTEM_PROMPT).toContain(f)
  })

  it("contains the load-bearing rules", () => {
    expect(LOTTIE_GRAPHIC_SYSTEM_PROMPT).toMatch(/"ty":\s*"gr"/)
    expect(LOTTIE_GRAPHIC_SYSTEM_PROMPT).toMatch(/sid/)
    expect(LOTTIE_GRAPHIC_SYSTEM_PROMPT).toMatch(/slots/)
    expect(LOTTIE_GRAPHIC_SYSTEM_PROMPT).toMatch(/expression/i)
  })

  it("ships an embedded example that passes the validator with zero auto-fixes", () => {
    // The example is the LAST JSON block, introduced by an unambiguous marker.
    const marker = "EXAMPLE OUTPUT (lower third):"
    const markerIdx = LOTTIE_GRAPHIC_SYSTEM_PROMPT.indexOf(marker)
    expect(markerIdx).toBeGreaterThan(-1)
    const start = LOTTIE_GRAPHIC_SYSTEM_PROMPT.indexOf("{", markerIdx)
    const end = LOTTIE_GRAPHIC_SYSTEM_PROMPT.lastIndexOf("}")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const parsed = extractExampleJson()
    const result = validateLottieGraphic(parsed, EXPECTED)

    // Natively correct: not rejected, the plan was assembled, validator changed NOTHING.
    expect(result.rejected).toBe(false)
    expect(result.plan).not.toBeNull()
    expect(result.autoFixed).toEqual([])
    expect(result.autoFixed.length).toBe(0)
  })

  it("the example's text slots render as bare strings through applySlots", () => {
    const parsed = extractExampleJson()
    const result = validateLottieGraphic(parsed, EXPECTED)
    expect(result.plan).not.toBeNull()
    const plan = result.plan as Record<string, unknown>

    // Default substitution: every text-doc s.t must be a RAW STRING (lottie-web
    // iterates string chars at this position — an {a,k} object renders broken).
    const lottie = plan.lottie as Record<string, unknown>
    const slots = plan.slots as Record<string, unknown>
    const substituted = applySlots(lottie, slots, {})
    const styles = textDocStyles(substituted)
    expect(styles.length).toBe(2) // name-text + role-text
    for (const s of styles) expect(typeof s.t).toBe("string")

    const serialized = JSON.stringify(substituted)
    expect(serialized).toContain("John Smith")
    expect(serialized).toContain("Product Designer")

    // Override the name slot: serialized output reflects the override, drops the default.
    const overridden = JSON.stringify(applySlots(lottie, slots, { nameText: "Ada Lovelace" }))
    expect(overridden).toContain("Ada Lovelace")
    expect(overridden).not.toContain("John Smith")
  })
})
