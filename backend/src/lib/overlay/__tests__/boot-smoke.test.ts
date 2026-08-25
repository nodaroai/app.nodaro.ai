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
  PEOPLE,
} from "@nodaro/prompts"

afterEach(() => {
  delete process.env.NODARO_OVERLAY_PACKAGE
  clearEgressDecorator()
  clearBillingProvider()
  clearPromptPolicies()
  resetCatalogPacks()
  resetPersonPacks()
})

describe("overlay boot-smoke — unset env is byte-identical, inert boot", () => {
  it("registers nothing when NODARO_OVERLAY_PACKAGE is unset", async () => {
    delete process.env.NODARO_OVERLAY_PACKAGE
    const result = await loadOverlay()
    expect(result).toEqual({ loaded: null })
    expect(getEgressDecorator()).toBeNull()
    expect(getBillingProvider().id).toBe("none")
    // No overlay ⇒ no packs registered. getRegisteredPeople() returns the base
    // PEOPLE reference unchanged (it only APPENDS pack entries), so identity to
    // the base is the inert-boot assertion — a person pack would fan out to a
    // catalog pack, which the length check below also catches.
    expect(getRegisteredCatalogPacks()).toHaveLength(0)
    expect(getRegisteredPeople()).toBe(PEOPLE)
    const p = applyPromptPolicies({ prompt: "x", negativePrompt: "", kind: "image" })
    expect(p).toEqual({ prompt: "x", negativePrompt: "", kind: "image" })
  })

  it("reads the real process.env name (blank string is inert, no throw)", async () => {
    process.env.NODARO_OVERLAY_PACKAGE = ""
    expect(await loadOverlay()).toEqual({ loaded: null })
    expect(getEgressDecorator()).toBeNull()
  })
})
