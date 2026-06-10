import { describe, it, expect } from "vitest"
import { buildWizardEnhanceSystem, buildWizardGenerateSystem } from "../prompt-wizard-system.js"

describe("buildWizardEnhanceSystem", () => {
  it("does NOT throw for a node type absent from the wizard category map (lip-sync)", () => {
    expect(() => buildWizardEnhanceSystem({ nodeType: "lip-sync" })).not.toThrow()
  })

  it("produces a one-shot prompt builder, not the analyze question form", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "generate-image", provider: "flux" })
    expect(sys).toContain('"prompt"')                  // generate-shaped JSON contract
    expect(sys).not.toContain("Available Categories")  // not the analyze form
    expect(sys).toMatch(/do not ask questions/i)
    expect(sys).toContain("Current provider: flux")
  })

  it("injects the Seedance doctrine when the current provider has one", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "text-to-video", provider: "seedance-2" })
    expect(sys).toContain("Provider Prompting Doctrine")
    expect(sys).toContain("Shot 1")           // untimed storyboard rule
    expect(sys).toContain("headshot")          // identity rule
    expect(sys).toContain("（")                // audio symbol semantics
  })

  it("omits the doctrine section for providers without one", () => {
    const sys = buildWizardEnhanceSystem({ nodeType: "text-to-video", provider: "veo3.1" })
    expect(sys).not.toContain("Provider Prompting Doctrine")
  })

  it("generate-form also receives the doctrine", () => {
    const sys = buildWizardGenerateSystem({
      nodeType: "text-to-video",
      provider: "seedance-2-fast",
      selections: [{ category: "mood-tone", value: "melancholic", isCustom: false }],
    })
    expect(sys).toContain("Provider Prompting Doctrine")
  })
})
