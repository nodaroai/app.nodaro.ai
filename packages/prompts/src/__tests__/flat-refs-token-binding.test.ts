/**
 * #2010 — `{image:N}` on the connected-reference path numbers the
 * `connectedReferences` entries, while the flat `referenceImageUrls` are sent
 * ahead of them. When the request has NO connected references at all — an API /
 * MCP call with `reference_image_urls` plus `described_references`, or with an
 * explicitly empty `connectedReferences` — the path was still entered, the photo
 * was sent at slot 1, and no token could ever bind: `{image:1:person}` rendered
 * as `person`. With nothing else to address, N counts the flat URLs, exactly as
 * it does on the flat path.
 *
 * Once any connected reference is present, the numbering is unchanged: N keeps
 * counting the connected entries (the last describe pins it).
 */
import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared/types"
import { buildImagePrompt } from "../prompt-builder.js"

const PHOTO = "https://cdn.example.com/photo.png"
const SECOND = "https://cdn.example.com/second.png"
const PROVIDER = "nano-banana-2"
const DESCRIBED = [{ name: "Natalie", description: "a tall woman with short silver hair" }]

describe("flat reference URLs with no connected references", () => {
  it("binds {image:1} to the first flat URL when only described references ride along", () => {
    const r = buildImagePrompt({
      prompt: "{image:1:person} walks through the market",
      provider: PROVIDER,
      referenceImageUrls: [PHOTO],
      describedReferences: DESCRIBED,
    })
    expect(r.referenceImageUrls).toEqual([PHOTO])
    expect(r.prompt).toContain("Image 1 (person) walks through the market")
    expect(r.prompt).toContain("Natalie")
  })

  it("binds {image:N} to the flat URLs when connectedReferences is an empty list", () => {
    const r = buildImagePrompt({
      prompt: "{image:2:jacket} on {image:1:person}",
      provider: PROVIDER,
      referenceImageUrls: [PHOTO, SECOND],
      connectedReferences: [],
    })
    expect(r.referenceImageUrls).toEqual([PHOTO, SECOND])
    expect(r.prompt).toContain("Image 2 (jacket) on Image 1 (person)")
  })

  it("binds in the hybrid reference format too", () => {
    const r = buildImagePrompt({
      prompt: "{image:1:person} at dusk",
      provider: PROVIDER,
      referenceFormat: "hybrid",
      referenceImageUrls: [PHOTO],
      connectedReferences: [],
    })
    expect(r.prompt).toContain("The person from reference image A at dusk")
  })

  it("still drops a token past the last flat URL to its label", () => {
    const r = buildImagePrompt({
      prompt: "{image:1:person} wears {image:2:jacket}",
      provider: PROVIDER,
      referenceImageUrls: [PHOTO],
      describedReferences: DESCRIBED,
    })
    expect(r.prompt).toContain("Image 1 (person) wears jacket")
    expect(r.prompt).not.toContain("{image:")
  })
})

describe("with connected references present, numbering is unchanged", () => {
  it("{image:1} binds the first connected entry, not the flat URL sent ahead of it", () => {
    const ref = { id: "r1", defaultName: "jacket", source: "wired-image", url: SECOND } as ConnectedReference
    const r = buildImagePrompt({
      prompt: "wear {image:1:jacket}",
      provider: PROVIDER,
      referenceImageUrls: [PHOTO],
      connectedReferences: [ref],
    })
    expect(r.referenceImageUrls).toEqual([PHOTO, SECOND])
    // The connected jacket sits at its real slot, 2.
    expect(r.prompt).toContain("Image 2 (jacket)")
    expect(r.prompt).not.toContain("Image 1 (jacket)")
  })
})
