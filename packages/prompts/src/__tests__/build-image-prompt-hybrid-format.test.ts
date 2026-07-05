/**
 * Hybrid reference format (images-only, flag-gated via
 * `BuildImagePromptConfig.referenceFormat === "hybrid"`).
 *
 * TOKEN EXPANSION ONLY: every `{image:N:label}` token becomes
 * "the <label> from reference image <LETTER>" (1=A, 2=B, …). NO reference-lock
 * snippet is auto-injected — authors prepend their own lock in the prompt text
 * (it passes through untouched). A caller may optionally prepend one via
 * `referenceLockSnippet`.
 *
 * Legacy (default, no `referenceFormat`) stays the "Use these references:/
 * Compose:" wrap with numeric `Image N` directives.
 */

import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

const PROVIDER = "nano-banana-pro" // in MODELS_WITH_REFERENCE_IMAGE_SUPPORT

const urlA = "https://r2/person-1.png" // image 1 → A
const urlB = "https://r2/clothes.png" // image 2 → B
const urlC = "https://r2/location.png" // image 3 → C
const urlD = "https://r2/person-2.png" // image 4 → D

const refs: ConnectedReference[] = [
  { id: "n1", defaultName: "Person 1", source: "wired-image", url: urlA },
  { id: "n2", defaultName: "Outfit", source: "wired-image", url: urlB },
  { id: "n3", defaultName: "Suite", source: "wired-image", url: urlC },
  { id: "n4", defaultName: "Person 2", source: "wired-image", url: urlD },
]

const TEMPLATE = [
  "{image:1:subject} is wearing {image:2:clothing}.",
  "{image:1:subject} is sitting, smiling and holding {image:3:glass}",
  "{image:4:subject} is wearing {image:1:clothing}.",
  "{image:4:subject} is standing and holding {image:3:smartphone}",
  "{image:3:location}",
].join("\n")

describe("hybrid reference format (images-only, flag-gated)", () => {
  it("expands tokens uniformly and does NOT auto-inject a lock", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: TEMPLATE,
      connectedReferences: refs,
      referenceFormat: "hybrid",
    })

    // no auto-lock: output starts straight with the expanded scene
    expect(
      prompt.startsWith(
        "The subject from reference image A is wearing the clothing from reference image B.",
      ),
    ).toBe(true)
    expect(prompt).not.toContain("Do not take anything from reference images")
    expect(prompt).not.toContain("Do not use anything from reference images")
    expect(prompt).not.toContain("must preserve likeness")
    expect(prompt).not.toContain("Compose them naturally")

    // uniform "the <label> from reference image <LETTER>"
    expect(prompt).toContain(
      "The subject from reference image A is sitting, smiling and holding the glass from reference image C",
    )
    // cross-route: subject D wears subject A's clothing
    expect(prompt).toContain(
      "The subject from reference image D is wearing the clothing from reference image A",
    )
    expect(prompt).toContain("The location from reference image C")

    // not legacy
    expect(prompt).not.toContain("Use these references")
    expect(prompt).not.toContain("Image 1 (")
  })

  it("passes an author-typed lock snippet through unchanged while expanding tokens", () => {
    const lockLine = "Do not use anything from reference images unless specified explicitly."
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: `${lockLine}\n{image:1:subject} smiling.`,
      connectedReferences: [refs[0]],
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe(`${lockLine}\nThe subject from reference image A smiling.`)
  })

  it("supports multi-word labels (widened token regex)", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "{image:1:person} is wearing {image:2:clothes and shoes}.",
      connectedReferences: [refs[0], refs[1]],
      referenceFormat: "hybrid",
    })
    expect(prompt).toContain(
      "The person from reference image A is wearing the clothes and shoes from reference image B.",
    )
  })

  it("optionally prepends a caller-supplied referenceLockSnippet", () => {
    const lock = "Take only what is specified. Do not take anything else."
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "{image:1:clothing}.",
      connectedReferences: [refs[0]],
      referenceFormat: "hybrid",
      referenceLockSnippet: lock,
    })
    expect(prompt.startsWith(`${lock}\n`)).toBe(true)
    expect(prompt).toContain("The clothing from reference image A.")
  })

  it("returns the 4 reference URLs in slot order (A,B,C,D)", () => {
    const { referenceImageUrls } = buildImagePrompt({
      provider: PROVIDER,
      prompt: TEMPLATE,
      connectedReferences: refs,
      referenceFormat: "hybrid",
    })
    expect(referenceImageUrls).toEqual([urlA, urlB, urlC, urlD])
  })

  it("legacy (default, no referenceFormat) is unchanged", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: TEMPLATE,
      connectedReferences: refs,
    })
    expect(prompt).toContain("Use these references for the output image:")
    expect(prompt).not.toContain("the clothing from reference image")
  })
})
