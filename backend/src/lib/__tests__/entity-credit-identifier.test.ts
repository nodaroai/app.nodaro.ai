import { describe, it, expect } from "vitest"
import { resolveEntityImageCreditIdentifier, resolveEntityImageParams } from "../entity-credit-identifier.js"
import { MODEL_CATALOG } from "@nodaro/shared"

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

  it("a lever the model doesn't support is DROPPED (no composite, never an error)", () => {
    // nano-banana has no quality tiering — the catalog snap DROPS the value
    // (see the `resolveEntityImageParams` block below, which asserts the worker
    // never receives it); pricing stays the base id either way.
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

describe("resolveEntityImageCreditIdentifier — refCountOverride (multi-image assembly)", () => {
  it("pins the Flux 2 ref-count to the override (the actual sent count), overriding the sourceImageUrl heuristic", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "flux-2-max", resolution: "2 MP" }, 4),
    ).toBe("flux-2-max:2MP:4ref")
    // Override wins even when sourceImageUrl is present (would otherwise be 1).
    expect(
      resolveEntityImageCreditIdentifier(
        { provider: "flux-2-max", resolution: "2 MP", sourceImageUrl: "https://x/p.png" },
        3,
      ),
    ).toBe("flux-2-max:2MP:3ref")
    expect(resolveEntityImageCreditIdentifier({ provider: "flux-2-pro" }, 0)).toBe("flux-2-pro:1MP:0ref")
  })

  it("is inert for non-ref-priced providers (override changes nothing)", () => {
    expect(resolveEntityImageCreditIdentifier({ provider: "nano-banana" }, 5)).toBe("nano-banana")
    expect(
      resolveEntityImageCreditIdentifier({ provider: "gpt-image", quality: "high" }, 5),
    ).toBe("gpt-image:high")
  })

  it("falls back to the sourceImageUrl-based count when no override is given (legacy CHECK behavior)", () => {
    expect(
      resolveEntityImageCreditIdentifier({ provider: "flux-2-max", resolution: "2 MP" }),
    ).toBe("flux-2-max:2MP:0ref")
  })
})

describe("catalog snap inside the entity credit identifier", () => {
  it("drops a resolution the model does not have", () => {
    const out = resolveEntityImageParams({ provider: "nano-banana", resolution: "2K" })
    expect(out.resolution).toBeUndefined()
    expect(out.identifier).toBe("nano-banana")
  })

  it("snaps a quality the model does not accept, without changing the price", () => {
    const out = resolveEntityImageParams({ provider: "gpt-image", quality: "basic" })
    // gpt-image declares ["medium", "high"] -> allowed[0]
    expect(out.quality).toBe("medium")
    expect(out.identifier).toBe("gpt-image")
  })

  it("keeps a declared quality and its composite price", () => {
    const out = resolveEntityImageParams({ provider: "gpt-image", quality: "high" })
    expect(out.quality).toBe("high")
    expect(out.identifier).toBe("gpt-image:high")
  })

  it("keeps the 2K/4K composite for a model that declares it", () => {
    expect(resolveEntityImageParams({ provider: "nano-banana-pro", resolution: "4K" }).identifier)
      .toBe("nano-banana-pro:4K")
  })

  it("resolveEntityImageCreditIdentifier stays byte-identical to resolveEntityImageParams().identifier", () => {
    const body = { provider: "gpt-image", quality: "high", sourceImageUrl: "https://r2.nodaro.ai/a.png" }
    expect(resolveEntityImageCreditIdentifier(body)).toBe(resolveEntityImageParams(body).identifier)
  })

  it("leaves a catalog-valid pair byte-identical (no gratuitous rewrite)", () => {
    const out = resolveEntityImageParams({ provider: "nano-banana-pro", resolution: "4K", quality: "high" })
    expect(out.resolution).toBe("4K")
    // nano-banana-pro declares no qualities -> the lever is dropped, not invented.
    expect(out.quality).toBeUndefined()
  })

  it("passes an unknown provider through untouched (the route enum is the gate)", () => {
    const out = resolveEntityImageParams({ provider: "not-a-model", resolution: "4K", quality: "high" })
    expect(out.resolution).toBe("4K")
    expect(out.quality).toBe("high")
    expect(out.identifier).toBe("not-a-model")
  })

  it("still carries the refCountOverride through the snap (Flux 2 per-ref pricing)", () => {
    const out = resolveEntityImageParams({ provider: "flux-2-max", resolution: "1K" }, 3)
    // "1K" is not a Flux 2 tier -> snapped onto the model's default megapixels.
    expect(out.resolution).toBe("2 MP")
    expect(out.identifier).toBe("flux-2-max:2MP:3ref")
  })
})

/**
 * The routes write the snapped pair back onto their Zod-parsed body through
 * `applySnappedLevers`, which re-parses each value through the route's OWN enum
 * and LEAVES THE CALLER'S VALUE ALONE when the enum cannot carry it. That
 * fallback would split the persisted `input_data` from the identifier the run
 * was priced on, so it must be unreachable — which is only true while every
 * value the snap can return for a lever the entity enums declare is itself in
 * that enum. Asserted here rather than assumed: a future catalog entry that
 * breaks it fails this test instead of silently mis-recording a job row.
 */
describe("the entity route enums can carry every value the snap returns", () => {
  // Mirrors `resolution` / `quality` in all four entity route bodies.
  const ROUTE_RESOLUTIONS = ["1K", "2K", "4K", "0.5 MP", "1 MP", "2 MP", "4 MP"] as const
  const ROUTE_QUALITIES = ["medium", "high", "basic"] as const

  it("snaps every route-enum resolution to a route-enum resolution, for every image model", () => {
    const allowed = new Set<string>(ROUTE_RESOLUTIONS)
    const offenders: string[] = []
    let checked = 0
    for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
      if (entry.kind !== "image") continue
      for (const resolution of ROUTE_RESOLUTIONS) {
        checked++
        const out = resolveEntityImageParams({ provider: id, resolution })
        if (out.resolution !== undefined && !allowed.has(out.resolution)) {
          offenders.push(`${id} + "${resolution}" -> "${out.resolution}"`)
        }
      }
    }
    expect(offenders).toEqual([])
    expect(checked).toBeGreaterThan(100)
  })

  it("snaps every route-enum quality to a route-enum quality, for every image model", () => {
    const allowed = new Set<string>(ROUTE_QUALITIES)
    const offenders: string[] = []
    let checked = 0
    for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
      if (entry.kind !== "image") continue
      for (const quality of ROUTE_QUALITIES) {
        checked++
        const out = resolveEntityImageParams({ provider: id, quality })
        if (out.quality !== undefined && !allowed.has(out.quality)) {
          offenders.push(`${id} + "${quality}" -> "${out.quality}"`)
        }
      }
    }
    expect(offenders).toEqual([])
    expect(checked).toBeGreaterThan(100)
  })
})
