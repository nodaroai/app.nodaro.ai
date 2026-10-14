// @test-watches frontend/src/components/editor/config-panel.tsx
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runButtonCreditOverride } from "@/hooks/use-seedance-ref-price"

/**
 * The settings panel's Run button prices a Seedance reference-video node the
 * way the node does: at the server's quote from the probed clips (what the run
 * reserves), never the `-ref` row, which is below it. While the quote loads it
 * shows no figure (0 hides the GenerateButton's figure); a node whose price does
 * not follow reference clips keeps the override it had.
 */
describe("settings-panel Run button — Seedance reference-video price", () => {
  it("a quoted node: the quote, or no figure while it loads", () => {
    expect(runButtonCreditOverride({ quoted: true, runCredits: 1911 }, undefined)).toBe(1911)
    expect(runButtonCreditOverride({ quoted: true, runCredits: 0 }, undefined)).toBe(0)
  })

  it("any other node keeps its own override (component price, provider sum, unit quote)", () => {
    expect(runButtonCreditOverride({ quoted: false, runCredits: 760 }, 40)).toBe(40)
    expect(runButtonCreditOverride({ quoted: false, runCredits: 760 }, undefined)).toBeUndefined()
  })

  it("config-panel.tsx routes the Run button's creditOverride through it", () => {
    const src = readFileSync(join(__dirname, "../../config-panel.tsx"), "utf8")
    expect(src).toMatch(/useNodeVideoPrice\(/)
    expect(src).toMatch(/creditOverride=\{runButtonCreditOverride\(/)
  })
})
