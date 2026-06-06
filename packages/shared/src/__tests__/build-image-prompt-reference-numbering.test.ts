/**
 * Reference-image numbering + non-character directive coverage.
 *
 * Regression suite for the `buildImagePrompt` defect where a no-`@`-mention
 * client (chips → connectedReferences + free-text) produced:
 *   - Bug A: character `Image N (Name)` directives pointed at the WRONG image
 *     because the final URL order prepended non-character refs while the
 *     directive numbers were computed against a different (non-prepended) order.
 *   - Bug B: unmentioned `wired-location` / `wired-object` refs were attached
 *     as images but received NO directive (model never told "this is the
 *     setting / this object").
 *
 * The load-bearing invariant these tests lock:
 *   For the returned `referenceImageUrls`, the URL at index N-1 is the subject
 *   of every `Image N (…)` directive in the returned prompt.
 */

import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

const PROVIDER = "nano-banana-pro" // in MODELS_WITH_REFERENCE_IMAGE_SUPPORT

// Identifiable URLs so an off-by-one is obvious in failure output.
const adamUrl = "https://r2/adam.png"
const ema2Url = "https://r2/ema2.png"
const cozyNestUrl = "https://r2/cozy-nest.png"
const swordUrl = "https://r2/sword.png"
const womanUrl1 = "https://r2/woman-1.png"
const womanUrl2 = "https://r2/woman-2.png"
const womanUrl3 = "https://r2/woman-3.png"

const adam: ConnectedReference = {
  id: "node-adam",
  defaultName: "Adam",
  source: "wired-character",
  url: adamUrl,
  characterSlug: "adam",
  variantSlug: undefined,
  characterCanonicalDescription: "older man, grey hair, broad shoulders",
}

const ema2: ConnectedReference = {
  id: "node-ema2",
  defaultName: "EMA2",
  source: "wired-character",
  url: ema2Url,
  characterSlug: "ema2",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, dark hair",
}

const cozyNest: ConnectedReference = {
  id: "node-cozy-nest",
  defaultName: "Cozy Nest",
  source: "wired-location",
  url: cozyNestUrl,
  locationSlug: "cozy-nest",
  locationCanonicalDescription: "A glowing forest nest, warm bioluminescence, soft moss",
}

const swordObject: ConnectedReference = {
  id: "node-sword",
  defaultName: "Hero Sword",
  source: "wired-object",
  url: swordUrl,
  description: "an ornate golden sword with a ruby pommel",
}

/**
 * Generic Bug-A invariant: every `Image N (Name…)` directive's index must
 * resolve, in the returned `referenceImageUrls`, to the URL we expect for that
 * name. `nameToUrl` maps the leading parenthetical token (before any " — desc")
 * to its expected URL. Names not in the map are ignored (e.g. opaque manual
 * uploads that carry no directive).
 */
function assertDirectiveIndicesMatchSlots(
  prompt: string,
  refs: readonly string[] | undefined,
  nameToUrl: Record<string, string>,
): void {
  expect(refs).toBeDefined()
  const re = /Image (\d+) \(([^)]+?)(?: —|\))/g
  let sawOne = false
  for (const m of prompt.matchAll(re)) {
    const n = parseInt(m[1], 10)
    const name = m[2].trim()
    const expectedUrl = nameToUrl[name]
    if (!expectedUrl) continue
    sawOne = true
    expect(refs![n - 1]).toBe(expectedUrl)
  }
  expect(sawOne).toBe(true) // guard against a regex that matched nothing
}

describe("buildImagePrompt — reference numbering (Bug A)", () => {
  it("character directives point at the URL actually in their slot (the repro)", () => {
    const result = buildImagePrompt({
      // NOTE: bare names only — NO @adam:1 / @cozy-nest:1 tokens.
      prompt: "Adam and EMA2 stand with the women at Cozy Nest, centered",
      provider: PROVIDER,
      referenceImageUrls: [womanUrl1, womanUrl2, womanUrl3],
      connectedReferences: [adam, ema2, cozyNest],
    })

    // The core invariant: each Image N directive resolves to the right URL.
    assertDirectiveIndicesMatchSlots(result.prompt, result.referenceImageUrls, {
      Adam: adamUrl,
      EMA2: ema2Url,
      location: cozyNestUrl,
    })

    // Concrete order (documents the fix: manual refs keep their slots, entities
    // follow, location appended last — never prepended).
    expect(result.referenceImageUrls).toEqual([
      womanUrl1,
      womanUrl2,
      womanUrl3,
      adamUrl,
      ema2Url,
      cozyNestUrl,
    ])
  })
})

describe("buildImagePrompt — non-character canonical fallback (Bug B)", () => {
  it("unmentioned wired-location gets a 'setting' directive carrying its canonical description", () => {
    const result = buildImagePrompt({
      prompt: "a wide establishing shot",
      provider: PROVIDER,
      connectedReferences: [cozyNest],
    })

    expect(result.referenceImageUrls).toEqual([cozyNestUrl])
    expect(result.prompt).toContain("use as the background/setting")
    expect(result.prompt).toContain("A glowing forest nest")
    // Directive index lines up with the URL slot.
    assertDirectiveIndicesMatchSlots(result.prompt, result.referenceImageUrls, {
      location: cozyNestUrl,
    })
  })

  it("unmentioned wired-object gets a directive describing the object", () => {
    const result = buildImagePrompt({
      prompt: "a knight holds it aloft",
      provider: PROVIDER,
      connectedReferences: [swordObject],
    })

    expect(result.referenceImageUrls).toEqual([swordUrl])
    expect(result.prompt).toContain("Image 1 (object — an ornate golden sword with a ruby pommel)")
    expect(result.prompt).toContain("match exactly")
    assertDirectiveIndicesMatchSlots(result.prompt, result.referenceImageUrls, {
      object: swordUrl,
    })
  })

  it("emits ONE directive (and one URL slot) when the same location is wired twice", () => {
    const dupe: ConnectedReference = { ...cozyNest, id: "node-cozy-nest-dupe" }
    const result = buildImagePrompt({
      prompt: "a scene",
      provider: PROVIDER,
      connectedReferences: [cozyNest, dupe],
    })
    // Same URL → one slot, one directive (no double-emit at the same index).
    expect(result.referenceImageUrls).toEqual([cozyNestUrl])
    const locationDirectives = (result.prompt.match(/Image \d+ \(location/g) ?? []).length
    expect(locationDirectives).toBe(1)
  })

  it("respects suppressedCanonicalLocationIds — directive emitted but canonical text dropped", () => {
    const result = buildImagePrompt({
      prompt: "a scene",
      provider: PROVIDER,
      connectedReferences: [cozyNest],
      suppressedCanonicalLocationIds: ["cozy-nest"],
    })
    // URL still attaches and the positional directive still fires…
    expect(result.referenceImageUrls).toEqual([cozyNestUrl])
    expect(result.prompt).toContain("Image 1 (location)")
    // …but the canonical description is suppressed.
    expect(result.prompt).not.toContain("A glowing forest nest")
  })
})

describe("buildImagePrompt — mixed fallback (characters + location + manual)", () => {
  it("numbers character fallback, location fallback, and manual refs consistently", () => {
    const result = buildImagePrompt({
      prompt: "a scene",
      provider: PROVIDER,
      referenceImageUrls: [womanUrl1, womanUrl2], // manual uploads, opaque
      connectedReferences: [adam, cozyNest],
    })

    // Final order: manual (1,2) → character fallback (3) → location fallback (4).
    expect(result.referenceImageUrls).toEqual([
      womanUrl1,
      womanUrl2,
      adamUrl,
      cozyNestUrl,
    ])
    assertDirectiveIndicesMatchSlots(result.prompt, result.referenceImageUrls, {
      Adam: adamUrl,
      location: cozyNestUrl,
    })
    // Manual uploads occupy slots 1-2 but carry NO directive (opaque URLs).
    expect(result.prompt).not.toMatch(/Image 1 \(/)
    expect(result.prompt).not.toMatch(/Image 2 \(/)
    // The labeled directives land at 3 and 4.
    expect(result.prompt).toContain("Image 3 (Adam)")
    expect(result.prompt).toMatch(/Image 4 \(location/)
  })
})

describe("buildImagePrompt — @-mention path is unaffected (no regression)", () => {
  it("fully @-mentioned character + location resolves identically (byte-for-byte stable)", () => {
    const result = buildImagePrompt({
      prompt: "@adam:1 stands at @cozy-nest:1",
      provider: PROVIDER,
      connectedReferences: [adam, cozyNest],
    })

    // Mention URLs attach in mention order; no prepend/append shuffle.
    expect(result.referenceImageUrls).toEqual([adamUrl, cozyNestUrl])
    // Character + location mention blocks both present, with their typed index.
    expect(result.prompt).toContain("Use these characters:")
    expect(result.prompt).toContain("Image 1 (Adam)")
    expect(result.prompt).toContain("Use these locations:")
    expect(result.prompt).toContain("Image 1 (Cozy Nest)")
    // Inline tokens replaced by display names.
    expect(result.prompt).toContain("Adam stands at Cozy Nest")
    expect(result.prompt).not.toMatch(/@adam:1\b/)
    expect(result.prompt).not.toMatch(/@cozy-nest:1\b/)
    // The location is NOT double-emitted via a fallback directive.
    expect(result.prompt).not.toMatch(/Image \d+ \(location/)
  })
})
