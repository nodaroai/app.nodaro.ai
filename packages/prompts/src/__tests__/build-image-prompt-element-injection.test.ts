import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

// A held-prop / styling / text element wired into a Character node carries a
// resolved `elementInjection` fragment. It must be woven INTO that character's
// own identity bullet under "Use these characters:" — NOT appended at the global
// tail (which is what wiring the element directly to the consumer's `elements`
// handle does). This is the user-reported bug: the smartphone hint showed up at
// the end of the whole prompt instead of as part of Image 1 (Alice).
const PROP = "holding a modern smartphone in one hand, fingers wrapped naturally around the device"

const aliceWithProp: ConnectedReference = {
  id: "ref-alice",
  defaultName: "Alice",
  source: "wired-character",
  description: "young woman",
  url: "https://r2/alice.png",
  characterSlug: "alice",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, hazel eyes, long dark hair, golden tan",
  elementInjection: PROP,
  variantDescription: null,
  variantDisplayName: "canonical",
}

const aliceNoProp: ConnectedReference = {
  ...aliceWithProp,
  elementInjection: undefined,
}

const victoria: ConnectedReference = {
  id: "ref-victoria",
  defaultName: "Victoria",
  source: "wired-character",
  description: "young woman",
  url: "https://r2/victoria.png",
  characterSlug: "victoria",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, grey-green eyes, medium brown hair",
  variantDescription: null,
  variantDisplayName: "canonical",
}

/** The directive block is everything before the first blank line. */
function directiveBlock(prompt: string): string {
  const i = prompt.indexOf("\n\n")
  return i === -1 ? prompt : prompt.slice(0, i)
}

describe("buildImagePrompt — ConnectedReference.elementInjection", () => {
  it("canonical fallback: weaves the injection INTO the character's bullet, not the prompt tail", () => {
    const result = buildImagePrompt({
      prompt: "a woman in a cafe",
      provider: "nano-banana-pro",
      connectedReferences: [aliceWithProp],
    })
    const block = directiveBlock(result.prompt)
    // The prop is inside the "Use these characters:" block...
    expect(block).toContain(PROP)
    // ...specifically inside Alice's own bullet, after her canonical description
    // and before the identity-lock directive.
    expect(result.prompt).toMatch(
      /- Image 1 \(Alice\) — young woman, hazel eyes, long dark hair, golden tan\. holding a modern smartphone[^\n]*\. The subject must remain/,
    )
    // ...and NOT dangling at the very end like a direct `elements` connection.
    expect(result.prompt.trimEnd().endsWith(PROP)).toBe(false)
  })

  it("scopes the injection to the wired character only (multi-character)", () => {
    const result = buildImagePrompt({
      prompt: "two women talking",
      provider: "nano-banana-pro",
      connectedReferences: [aliceWithProp, victoria],
    })
    // Alice's bullet carries the prop; Victoria's does not.
    expect(result.prompt).toMatch(/- Image 1 \(Alice\)[^\n]*holding a modern smartphone/)
    expect(result.prompt).toMatch(/- Image 2 \(Victoria\)(?:(?!holding a modern smartphone)[^\n])*\n/)
    // The prop appears exactly once.
    expect((result.prompt.match(/holding a modern smartphone/g) || []).length).toBe(1)
  })

  it("@-mention: injection rides the mentioned character's bullet", () => {
    const result = buildImagePrompt({
      prompt: "feature @alice:1 prominently",
      provider: "nano-banana-pro",
      connectedReferences: [aliceWithProp],
    })
    expect(result.prompt).toMatch(/- Image 1 \(Alice\)[^\n]*holding a modern smartphone/)
  })

  it("rides the bullet even with NO canonical description (mode-independent)", () => {
    const result = buildImagePrompt({
      prompt: "a woman in a cafe",
      provider: "nano-banana-pro",
      connectedReferences: [{ ...aliceWithProp, characterCanonicalDescription: null }],
    })
    // No canonical desc, but the prop still attaches to Alice's subject.
    expect(result.prompt).toMatch(/- Image 1 \(Alice\) — holding a modern smartphone/)
  })

  it("byte-identical to today when elementInjection is absent", () => {
    const withUndef = buildImagePrompt({
      prompt: "a woman in a cafe",
      provider: "nano-banana-pro",
      connectedReferences: [aliceNoProp],
    })
    const withEmpty = buildImagePrompt({
      prompt: "a woman in a cafe",
      provider: "nano-banana-pro",
      connectedReferences: [{ ...aliceNoProp, elementInjection: "   " }],
    })
    // Whitespace-only injection collapses to the same output as no injection.
    expect(withEmpty.prompt).toBe(withUndef.prompt)
    // And the prop text never appears.
    expect(withUndef.prompt).not.toContain("smartphone")
  })
})
