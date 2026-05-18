/**
 * Reference-order parity tests.
 *
 * `buildImagePrompt` now accepts an optional `referenceOrder` parameter
 * (stable tile-IDs from `compute-injected-refs.ts`) AND
 * `suppressedCanonicalCharacterIds` (slugs whose canonical-fallback the user
 * has hidden). These tests pin:
 *   - reorder remaps both URLs AND `Image N` directives consistently
 *   - empty / stale referenceOrder is a no-op
 *   - suppression drops the URL + the directive line
 *   - identical fixtures produce identical URL lists on frontend (via
 *     `computeInjectedRefs`) and backend (via `buildImagePrompt` with
 *     `referenceOrder`) — load-bearing for cross-process parity.
 */

import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

const wiredUpload: ConnectedReference = {
  id: "node-upload-1",
  defaultName: "Upload 1",
  source: "wired-image",
  url: "https://r2/upload-1.png",
}

const kiraCanonical: ConnectedReference = {
  id: "node-kira",
  defaultName: "Kira",
  source: "wired-character",
  description: "young woman with warm smile",
  url: "https://r2/kira-portrait.png",
  characterSlug: "kira",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, brown eyes, auburn hair",
  variantDescription: null,
  variantDisplayName: "canonical",
}

const kiraSmile: ConnectedReference = {
  id: "node-kira_expr_smile",
  defaultName: "Kira / smile",
  source: "wired-character",
  description: "warm closed-mouth smile",
  url: "https://r2/kira-smile.png",
  characterSlug: "kira",
  variantSlug: "smile",
  characterCanonicalDescription: "young woman, brown eyes, auburn hair",
  variantDescription: "warm closed-mouth smile",
  variantDisplayName: "smile",
}

const adamCanonical: ConnectedReference = {
  id: "node-adam",
  defaultName: "Adam",
  source: "wired-character",
  description: "older man",
  url: "https://r2/adam-portrait.png",
  characterSlug: "adam",
  variantSlug: undefined,
  characterCanonicalDescription: "older man, grey hair",
  variantDescription: null,
  variantDisplayName: "canonical",
}

describe("buildImagePrompt — referenceOrder", () => {
  it("returns natural URL order when no referenceOrder is provided", () => {
    const result = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
    })
    // Natural order from buildImagePrompt:
    //   referenceImageUrls + mentions + canonical-fallback
    //   = [] + [kiraSmile] + [adamCanonical]
    expect(result.referenceImageUrls).toEqual([
      kiraSmile.url,
      adamCanonical.url,
    ])
  })

  it("reorders URLs to match referenceOrder", () => {
    const result = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [
        "char-canonical:adam",
        "mention:kira:smile",
      ],
    })
    expect(result.referenceImageUrls).toEqual([
      adamCanonical.url,
      kiraSmile.url,
    ])
  })

  it("renumbers Image N directives consistently after reorder", () => {
    const result = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [
        "char-canonical:adam",
        "mention:kira:smile",
      ],
    })
    // After reorder Adam is Image 1, Kira is Image 2 — directives must follow.
    // Kira's directive used to say "Image 1 (Kira)" since the mention was
    // `@kira:1:smile`; the renumber rewrites it to "Image 2 (Kira)".
    expect(result.prompt).toContain("Image 1 (Adam)")
    expect(result.prompt).toContain("Image 2 (Kira)")
    // And does NOT contain the old positions.
    expect(result.prompt).not.toMatch(/Image 1 \(Kira\)/)
    expect(result.prompt).not.toMatch(/Image 2 \(Adam\)/)
  })

  it("ignores stale IDs in referenceOrder without breaking the layout", () => {
    const result = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [
        "stale:nonexistent",
        "char-canonical:adam",
        "wired:also-deleted",
      ],
    })
    // adam goes first (matched), then natural-order tail (kira smile).
    expect(result.referenceImageUrls).toEqual([
      adamCanonical.url,
      kiraSmile.url,
    ])
  })

  it("empty referenceOrder is a no-op (identical output to no order)", () => {
    const a = buildImagePrompt({
      prompt: "scene of @kira:1:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
    })
    const b = buildImagePrompt({
      prompt: "scene of @kira:1:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [],
    })
    expect(a.prompt).toEqual(b.prompt)
    expect(a.referenceImageUrls).toEqual(b.referenceImageUrls)
  })

  it("identity reorder (same as natural order) is a no-op", () => {
    const natural = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
    })
    const identity = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [
        "mention:kira:smile",
        "char-canonical:adam",
      ],
    })
    expect(natural.prompt).toEqual(identity.prompt)
    expect(natural.referenceImageUrls).toEqual(identity.referenceImageUrls)
  })

  it("handles wired raw + mention + canonical reorder together", () => {
    const result = buildImagePrompt({
      prompt: "scene of @kira:1:smile and Adam",
      provider: "nano-banana-pro",
      referenceImageUrls: [wiredUpload.url],
      connectedReferences: [wiredUpload, kiraCanonical, kiraSmile, adamCanonical],
      referenceOrder: [
        "char-canonical:adam",
        "wired:node-upload-1",
        "mention:kira:smile",
      ],
    })
    expect(result.referenceImageUrls).toEqual([
      adamCanonical.url,
      wiredUpload.url,
      kiraSmile.url,
    ])
  })

  it("preserves natural order for tiles missing from referenceOrder", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:smile and Adam",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
      // Only one ID provided — the other tile falls through in natural order.
      referenceOrder: ["char-canonical:adam"],
    })
    // adam first, then kira smile (natural tail).
    expect(result.referenceImageUrls).toEqual([
      adamCanonical.url,
      kiraSmile.url,
    ])
  })

  it("no-op when reference order moves a single-URL list", () => {
    const result = buildImagePrompt({
      prompt: "feature @kira:1",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
      referenceOrder: ["mention:kira:canonical"],
    })
    // Only one URL to reorder — fast-path skips the regex.
    expect(result.referenceImageUrls).toEqual([kiraCanonical.url])
    expect(result.prompt).toContain("Image 1")
  })
})

describe("buildImagePrompt — suppressedCanonicalCharacterIds", () => {
  it("drops canonical URL + directive when slug is suppressed", () => {
    const result = buildImagePrompt({
      prompt: "",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, adamCanonical],
      suppressedCanonicalCharacterIds: ["kira"],
    })
    expect(result.referenceImageUrls).toEqual([adamCanonical.url])
    // Kira directive should not appear.
    expect(result.prompt).toContain("(Adam)")
    expect(result.prompt).not.toContain("(Kira)")
  })

  it("does NOT drop @-mention URLs for a suppressed slug", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
      suppressedCanonicalCharacterIds: ["kira"],
    })
    expect(result.referenceImageUrls).toEqual([kiraSmile.url])
  })

  it("does not affect non-character refs", () => {
    const result = buildImagePrompt({
      prompt: "",
      provider: "nano-banana-pro",
      connectedReferences: [wiredUpload, kiraCanonical, adamCanonical],
      referenceImageUrls: [wiredUpload.url],
      suppressedCanonicalCharacterIds: ["kira"],
    })
    expect(result.referenceImageUrls).toEqual([
      wiredUpload.url,
      adamCanonical.url,
    ])
  })
})

describe("buildImagePrompt — suppressedCanonicalLocationIds", () => {
  // The location canonical-fallback path will be added in a follow-up PR (the
  // Location Studio Phase 1 spec is what adds the actual `wired-location`
  // canonical injection via `injected-reference-helpers.ts`). For now, this
  // test pins the cross-cutting contract: the parameter is accepted, the
  // signature matches `suppressedCanonicalCharacterIds`, and the helper never
  // crashes when location ids are passed.

  it("accepts suppressedCanonicalLocationIds as an empty array", () => {
    const result = buildImagePrompt({
      prompt: "scenic shot",
      provider: "nano-banana-pro",
      suppressedCanonicalLocationIds: [],
    })
    expect(result.prompt).toContain("scenic shot")
  })

  it("accepts a non-empty suppressedCanonicalLocationIds without crashing", () => {
    const result = buildImagePrompt({
      prompt: "scenic shot",
      provider: "nano-banana-pro",
      connectedReferences: [wiredUpload],
      referenceImageUrls: [wiredUpload.url],
      suppressedCanonicalLocationIds: ["beach", "rooftop"],
    })
    // Pre-existing refs flow through untouched; the parameter is a no-op
    // until the location canonical-fallback path lands in a follow-up.
    expect(result.referenceImageUrls).toEqual([wiredUpload.url])
  })

  it("does not affect character canonical refs", () => {
    const result = buildImagePrompt({
      prompt: "",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, adamCanonical],
      suppressedCanonicalLocationIds: ["kira", "adam"],
    })
    expect(result.referenceImageUrls).toEqual([
      kiraCanonical.url,
      adamCanonical.url,
    ])
  })

  it("composes cleanly with suppressedCanonicalCharacterIds", () => {
    const result = buildImagePrompt({
      prompt: "",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, adamCanonical],
      suppressedCanonicalCharacterIds: ["kira"],
      suppressedCanonicalLocationIds: ["beach"],
    })
    // Character suppression still drops Kira; location ids are inert today.
    expect(result.referenceImageUrls).toEqual([adamCanonical.url])
    expect(result.prompt).toContain("(Adam)")
    expect(result.prompt).not.toContain("(Kira)")
  })
})
