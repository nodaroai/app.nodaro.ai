import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  normalizeModelInput,
} from "../model-catalog.js"
import {
  HIGH_QUALITY_PROVIDERS,
  IMAGE_ASPECT_RATIO_VALUES,
  TWO_K_RESOLUTION_PROVIDERS,
  RESOLUTION_2K_4K_TIERED_PROVIDERS,
} from "../model-constants.js"
import { FLUX2_RES_MP, isFlux2Model } from "../flux2-pricing.js"

/**
 * `resolveNormalizedImageGen` prices the credit identifier off the SNAPPED
 * lever values (see credit-identifiers.ts). That is only safe while every
 * value a pricing set keys on is also DECLARED on that model's catalog entry:
 * a priced value the catalog omits would be snapped away or rewritten, and the
 * reserve would silently move to a different tier.
 *
 * A model that is priced on a lever but ABSENT from MODEL_CATALOG is fine —
 * `normalizeModelInput` passes unknown ids through untouched.
 */
describe("composite image pricing ⊆ catalog-declared levers", () => {
  it("every HIGH_QUALITY_PROVIDERS member in the catalog declares quality \"high\"", () => {
    let checked = 0
    for (const id of HIGH_QUALITY_PROVIDERS) {
      const entry = MODEL_CATALOG[id]
      if (!entry) continue
      checked++
      expect(entry.qualities, `${id}.qualities`).toBeDefined()
      expect(entry.qualities, `${id}.qualities`).toContain("high")
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("every TWO_K_RESOLUTION_PROVIDERS member in the catalog declares \"2K\"", () => {
    let checked = 0
    for (const id of TWO_K_RESOLUTION_PROVIDERS) {
      const entry = MODEL_CATALOG[id]
      if (!entry) continue
      checked++
      expect(entry.resolutions, `${id}.resolutions`).toContain("2K")
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("every RESOLUTION_2K_4K_TIERED_PROVIDERS member in the catalog declares \"2K\" and \"4K\"", () => {
    let checked = 0
    for (const id of RESOLUTION_2K_4K_TIERED_PROVIDERS) {
      const entry = MODEL_CATALOG[id]
      if (!entry) continue
      checked++
      expect(entry.resolutions, `${id}.resolutions`).toContain("2K")
      expect(entry.resolutions, `${id}.resolutions`).toContain("4K")
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("nano-banana-pro declares \"4K\" (its own pricing branch)", () => {
    expect(MODEL_CATALOG["nano-banana-pro"]?.resolutions).toContain("4K")
  })

  // Flux 2 stores a BARE megapixel count ("1") while the catalog lists "1 MP".
  // normalizeModelInput canonicalizes rather than "corrects" that spelling —
  // if it ever stopped doing so, every Flux 2 node priced from stored data
  // would jump to defaultResolutionFor()'s tier.
  it("Flux 2 bare-MP values canonicalize to the catalog spelling, not a different tier", () => {
    let checked = 0
    for (const id of Object.keys(MODEL_CATALOG)) {
      if (!isFlux2Model(id)) continue
      checked++
      for (const mp of FLUX2_RES_MP) {
        const out = normalizeModelInput(id, { resolution: mp })
        expect(out.resolution, `${id} + "${mp}"`).toBe(`${mp} MP`)
        expect(out.adjustments, `${id} + "${mp}" must not report a correction`).toEqual([])
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  // Declared values are always identity under the snap. Cheap, and it fails
  // loudly if someone adds a duplicate/typo'd entry to a lever list.
  it("every declared image lever value normalizes to itself", () => {
    for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
      if (entry.kind !== "image") continue
      for (const a of entry.aspectRatios ?? []) {
        expect(normalizeModelInput(id, { aspectRatio: a }).aspectRatio, `${id} ratio ${a}`).toBe(a)
      }
      for (const r of entry.resolutions ?? []) {
        expect(normalizeModelInput(id, { resolution: r }).resolution, `${id} res ${r}`).toBe(r)
      }
      for (const q of entry.qualities ?? []) {
        expect(normalizeModelInput(id, { quality: q }).quality, `${id} quality ${q}`).toBe(q)
      }
    }
  })
})

/**
 * `IMAGE_ASPECT_RATIO_VALUES` is the ONE ratio vocabulary the three image
 * routes' Zod enums are built from (`/v1/generate-image`, `/v1/image-to-image`,
 * `/v1/edit-image`). Two invariants make that safe, and both are asserted here
 * rather than left to review:
 *
 *  1. It must be a SUPERSET of every ratio any image model declares. A catalog
 *     ratio the tuple omits is a live 400 on a value the picker offers — the
 *     exact bug that shipped twice (Wan 2.7's `8:1`/`1:8`, then Nano Banana 2
 *     Lite's `4:1`/`1:4`). It also makes `applySnappedLevers`' "enum can't carry
 *     the snapped value" fallback unreachable: the snap can only ever return a
 *     value the caller sent, its canonical spelling, or a catalog-declared
 *     option — all three are in the tuple by this test.
 *  2. No duplicates. `z.enum` de-dupes silently, so a copy-paste repeat would
 *     never surface at runtime.
 *
 * Widening the tuple is always safe: the per-model gate is the catalog snap,
 * which CORRECTS an unsupported ratio (and discloses it) instead of rejecting.
 */
describe("IMAGE_ASPECT_RATIO_VALUES covers every catalog-declared image ratio", () => {
  it("is a superset of every `kind: \"image\"` entry's aspectRatios", () => {
    const allowed = new Set<string>(IMAGE_ASPECT_RATIO_VALUES)
    const missing: string[] = []
    let checked = 0
    for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
      if (entry.kind !== "image") continue
      for (const r of entry.aspectRatios ?? []) {
        checked++
        if (!allowed.has(r)) missing.push(`${id} declares "${r}"`)
      }
    }
    expect(missing).toEqual([])
    // Guard the guard: an empty catalog sweep would make this vacuous.
    expect(checked).toBeGreaterThan(100)
  })

  it("has no duplicate entries (z.enum would swallow them)", () => {
    expect(new Set<string>(IMAGE_ASPECT_RATIO_VALUES).size).toBe(IMAGE_ASPECT_RATIO_VALUES.length)
  })
})
