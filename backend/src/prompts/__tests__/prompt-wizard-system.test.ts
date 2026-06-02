import { describe, it, expect } from "vitest"
import { buildWizardEnhanceSystem } from "../prompt-wizard-system.js"

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
})
