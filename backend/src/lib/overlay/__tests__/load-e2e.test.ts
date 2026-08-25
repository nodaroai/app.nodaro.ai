import { describe, it, expect, afterEach } from "vitest"
import { loadOverlay } from "../load.js"
import { getEgressDecorator, clearEgressDecorator } from "../../../providers/egress.js"
import { getBillingProvider, clearBillingProvider } from "../../billing-provider.js"
import { applyPromptPolicies, clearPromptPolicies } from "../../prompt-policy.js"
import {
  getRegisteredCatalogPacks,
  resetCatalogPacks,
  getRegisteredPeople,
  resetPersonPacks,
} from "@nodaro/prompts"
import * as fixture from "./fixtures/test-overlay.js"

afterEach(() => {
  clearEgressDecorator()
  clearBillingProvider()
  clearPromptPolicies()
  resetCatalogPacks()
  resetPersonPacks()
})

describe("loadOverlay — end-to-end registration via an in-repo fixture", () => {
  it("runs register() which wires all five seams; needs no real overlay package", async () => {
    const result = await loadOverlay({
      importer: async () => fixture,
      exit: (() => undefined) as never,
      packageName: "test-overlay",
    })
    expect(result).toEqual({ loaded: "test-overlay" })

    // egress decorator installed
    expect(
      getEgressDecorator()?.decorate({
        provider: "kie",
        operation: "t",
        modelKey: null,
        body: {},
        dimensions: {},
      }),
    ).toEqual({ headers: { "X-Test-Overlay": "1" } })
    // billing provider replaced
    expect(getBillingProvider().id).toBe("test-overlay-billing")
    // prompt policy applied
    expect(applyPromptPolicies({ prompt: "hello", negativePrompt: "", kind: "image" }).prompt).toBe(
      "hello [overlay]",
    )
    // catalog + person packs registered
    expect(getRegisteredCatalogPacks().some((p) => p.id === "test-overlay-catalog")).toBe(true)
    expect(getRegisteredPeople().some((p) => p.id === "test-person-1")).toBe(true)
  })
})
