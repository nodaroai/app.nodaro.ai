import { describe, it, expect } from "vitest"
import { resolveEntityImageCreditIdentifier } from "../entity-credit-identifier.js"

/**
 * The entity routes' CHECK===DEBIT contract: the credit-guard preHandler runs
 * this resolver on the RAW (pre-Zod) body and the handler runs it on the
 * Zod-parsed data (same field names) — one derivation site, so the advisory
 * check and the reservation can never price different tiers. These tests pin
 * the identifier space against `buildCreditModelIdentifier`'s provider sets.
 */
describe("resolveEntityImageCreditIdentifier", () => {
  it("defaults to nano-banana on an empty / non-object body", () => {
    expect(resolveEntityImageCreditIdentifier({})).toBe("nano-banana")
    expect(resolveEntityImageCreditIdentifier(null)).toBe("nano-banana")
    expect(resolveEntityImageCreditIdentifier(undefined)).toBe("nano-banana")
    expect(resolveEntityImageCreditIdentifier("nonsense")).toBe("nano-banana")
  })

  it("passes a plain provider through unchanged (legacy behavior)", () => {
    expect(resolveEntityImageCreditIdentifier({ provider: "nano-banana" })).toBe("nano-banana")
    expect(resolveEntityImageCreditIdentifier({ provider: "nano-banana-pro" })).toBe("nano-banana-pro")
  })

  it("quality=high composes for high-quality-priced providers (gpt-image)", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "gpt-image", quality: "high" }),
    ).toBe("gpt-image:high")
  })

  it("quality=medium stays base (medium is the default tier)", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "gpt-image", quality: "medium" }),
    ).toBe("gpt-image")
  })

  it("resolution=4K composes for nano-banana-pro; 2K stays base", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "nano-banana-pro", resolution: "4K" }),
    ).toBe("nano-banana-pro:4K")
    expect(
      resolveEntityImageCreditIdentifier({ provider: "nano-banana-pro", resolution: "2K" }),
    ).toBe("nano-banana-pro")
  })

  it("resolution=2K composes for the flux family", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "flux", resolution: "2K" }),
    ).toBe("flux:2K")
  })

  it("a lever the model doesn't support is IGNORED (no composite, never an error)", () => {
    // nano-banana has no quality tiering — the value rides to the worker where
    // the provider ignores it; pricing stays the base id.
    expect(
      resolveEntityImageCreditIdentifier({ provider: "nano-banana", quality: "high" }),
    ).toBe("nano-banana")
    expect(
      resolveEntityImageCreditIdentifier({ provider: "nano-banana", resolution: "4K" }),
    ).toBe("nano-banana")
  })

  it("flux-2 family encodes megapixels + the sourceImageUrl ref count", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "flux-2-max", resolution: "2 MP" }),
    ).toBe("flux-2-max:2MP:0ref")
    expect(
      resolveEntityImageCreditIdentifier({
        provider: "flux-2-max",
        resolution: "2 MP",
        sourceImageUrl: "https://example.com/ref.png",
      }),
    ).toBe("flux-2-max:2MP:1ref")
    // No resolution → 1 MP default (mirrors buildCreditModelIdentifier).
    expect(
      resolveEntityImageCreditIdentifier({
        provider: "flux-2-pro",
        sourceImageUrl: "https://example.com/ref.png",
      }),
    ).toBe("flux-2-pro:1MP:1ref")
  })

  it("ignores non-string lever values (defensive raw-body reads)", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "gpt-image", quality: 5, resolution: { v: "4K" } }),
    ).toBe("gpt-image")
    expect(
      resolveEntityImageCreditIdentifier({ provider: "flux-2-max", sourceImageUrl: 42 }),
    ).toBe("flux-2-max:1MP:0ref")
  })
})
