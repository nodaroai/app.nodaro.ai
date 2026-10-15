/**
 * `assembleImageInput` with a caller's RESOLVED palette / moodboard:
 *
 * - `directionRefs` — the clause each user-owned direction id resolved to,
 *   folded in that row's slot like a catalog clause;
 * - `styleReferences` — a moodboard's images. They only FILL the reference
 *   seats the caller's own references leave free, after them, and never move,
 *   renumber or evict one of the caller's own (the attach-priority cap would
 *   otherwise let a style image push out a mentioned character variant).
 */
import { describe, it, expect } from "vitest"
import { assembleImageInput } from "../assemble-image-input.js"
import { styleReferenceDescription } from "../user-direction-refs.js"
import { imageReferenceLimit } from "@nodaro/shared/models"
import type { ConnectedReference } from "@nodaro/shared/types"

const PALETTE = "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MOODBOARD = "moodboard:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const style = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ url: `https://cdn.test/mood-${i + 1}.png` }))
const flat = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.test/own-${i + 1}.png`)

const kira: ConnectedReference[] = [
  { id: "k0", defaultName: "Kira", source: "wired-character", url: "https://cdn.test/kira.png", characterSlug: "kira", characterCanonicalDescription: "a red-haired woman" },
  { id: "k1", defaultName: "Kira", source: "wired-character", url: "https://cdn.test/kira-smile.png", characterSlug: "kira", variantSlug: "smile" },
]

describe("directionRefs", () => {
  it("folds a resolved palette onto the [style] film line", () => {
    const result = assembleImageInput({
      userPrompt: "a cat on a sofa",
      provider: "nano-banana-pro",
      direction: { colorLook: PALETTE },
      directionRefs: new Map([[PALETTE, "color palette: deep teal #0F4C5C"]]),
    })
    expect(result.prompt).toBe("a cat on a sofa\n\n[style]:\ncolor palette: deep teal #0F4C5C")
  })

  it("folds nothing for an id it was not handed (the platform resolves before assembling)", () => {
    const result = assembleImageInput({ userPrompt: "a cat", provider: "nano-banana-pro", direction: { style: MOODBOARD } })
    expect(result.prompt).toBe("a cat")
  })
})

describe("styleReferences — absent is byte-identical", () => {
  it("adds no field and changes nothing when none are given", () => {
    const input = { userPrompt: "a cat", provider: "nano-banana-pro", extraReferenceImageUrls: flat(2) }
    const result = assembleImageInput(input)
    expect(result).toEqual(assembleImageInput({ ...input, styleReferences: undefined }))
    expect("styleReferencesSent" in result).toBe(false)
  })
})

describe("styleReferences — fill the free seats, after the caller's own", () => {
  it("appends them after the caller's references and says how many went", () => {
    for (const referenceFormat of ["legacy", "hybrid"] as const) {
      const base = assembleImageInput({ userPrompt: "a cat", provider: "nano-banana-pro", extraReferenceImageUrls: flat(2), referenceFormat })
      const result = assembleImageInput({
        userPrompt: "a cat",
        provider: "nano-banana-pro",
        extraReferenceImageUrls: flat(2),
        referenceFormat,
        styleReferences: style(3),
      })
      expect(result.referenceImageUrls, referenceFormat).toEqual([...base.referenceImageUrls!, ...style(3).map((s) => s.url)])
      expect(result.styleReferencesSent, referenceFormat).toBe(3)
      expect(result.prompt, referenceFormat).toContain(styleReferenceDescription(0))
      expect(result.prompt, referenceFormat).toContain(styleReferenceDescription(1))
    }
  })

  it("never sends more than the model takes: the caller's references come first", () => {
    const cap = imageReferenceLimit("nano-banana-pro")
    const result = assembleImageInput({
      userPrompt: "a cat",
      provider: "nano-banana-pro",
      extraReferenceImageUrls: flat(cap - 2),
      styleReferences: style(5),
    })
    expect(result.referenceImageUrls).toEqual([...flat(cap - 2), ...style(2).map((s) => s.url)])
    expect(result.styleReferencesSent).toBe(2)
  })

  it("sends none when the caller already fills every seat", () => {
    const cap = imageReferenceLimit("nano-banana-pro")
    const result = assembleImageInput({
      userPrompt: "a cat",
      provider: "nano-banana-pro",
      extraReferenceImageUrls: flat(cap),
      styleReferences: style(2),
    })
    expect(result.referenceImageUrls).toEqual(flat(cap))
    expect(result.styleReferencesSent).toBe(0)
  })

  it("never evicts a mentioned character variant to make room", () => {
    // cap 8; the caller's two connected entries (a canonical + the mentioned
    // variant) send ONE image, so seven seats look free — but seven style
    // images would push the raw list past the attach-priority cap, which
    // keeps non-variants first and would drop the mentioned variant.
    const base = assembleImageInput({
      userPrompt: "@kira:2:smile walking",
      provider: "nano-banana-pro",
      connectedReferences: kira,
      referenceFormat: "hybrid",
    })
    expect(base.referenceImageUrls).toEqual(["https://cdn.test/kira-smile.png"])
    const result = assembleImageInput({
      userPrompt: "@kira:2:smile walking",
      provider: "nano-banana-pro",
      connectedReferences: kira,
      referenceFormat: "hybrid",
      styleReferences: style(12),
    })
    expect(result.referenceImageUrls![0]).toBe("https://cdn.test/kira-smile.png")
    expect(result.styleReferencesSent).toBe(6)
    expect(result.referenceImageUrls).toEqual(["https://cdn.test/kira-smile.png", ...style(6).map((s) => s.url)])
  })

  it("skips a style image the caller already sends, and fills with the next", () => {
    const own = flat(1)
    const result = assembleImageInput({
      userPrompt: "a cat",
      provider: "nano-banana-pro",
      extraReferenceImageUrls: own,
      styleReferences: [{ url: own[0] }, ...style(2)],
    })
    expect(result.referenceImageUrls).toEqual([own[0], ...style(2).map((s) => s.url)])
    expect(result.styleReferencesSent).toBe(2)
  })

  it("sends none to a model that takes no reference images", () => {
    expect(imageReferenceLimit("imagen4")).toBe(0)
    const result = assembleImageInput({ userPrompt: "a cat", provider: "imagen4", styleReferences: style(2) })
    expect(result.referenceImageUrls ?? []).toEqual([])
    expect(result.styleReferencesSent).toBe(0)
    expect(result.prompt).toBe("a cat")
  })

  it("sends none on the trained-character (LoRA) path, which takes no references", () => {
    const result = assembleImageInput({
      userPrompt: "@kira walking",
      provider: "nano-banana-pro",
      connectedReferences: kira,
      skipCharacterMentions: true,
      styleReferences: style(2),
    })
    expect(result.referenceImageUrls ?? []).toEqual([])
    expect(result.styleReferencesSent).toBe(0)
  })

  it("carries each image's caption into its line", () => {
    const result = assembleImageInput({
      userPrompt: "a cat",
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
      styleReferences: [{ url: "https://cdn.test/m.png", caption: "linen and oak" }],
    })
    expect(result.prompt).toContain(styleReferenceDescription(0, "linen and oak"))
  })

  it("an empty prompt with style images is not an empty prompt", () => {
    const result = assembleImageInput({
      userPrompt: "",
      provider: "nano-banana-pro",
      styleReferences: style(1),
      throwOnEmpty: true,
    })
    expect(result.styleReferencesSent).toBe(1)
    expect(result.prompt.trim().length).toBeGreaterThan(0)
    expect(() => assembleImageInput({ userPrompt: "", provider: "nano-banana-pro", throwOnEmpty: true })).toThrow(/No prompt/)
  })
})
