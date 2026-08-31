import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * Seam whitespace at a resolved mention (image path).
 *
 * A live prod payload assembled to
 *
 *   "the person from reference image A  and reference image C walking …"
 *
 * — TWO spaces after the character phrase. An editor serializes a mention chip
 * as its token plus its own trailing space, and the prose that follows carries
 * the space the author typed, so an ordinary sentence reaches the route as
 * `@panda:1  and @panda2:2 …`. The VIDEO core never shows this: every return of
 * `resolveVideoReferenceCore` runs `resolveReferenceTokens`, whose
 * `[^\S\r\n]{2,}` collapse tidies the gap. The image path had no such tidy, so
 * the doubled space landed in the model's prompt exactly where the reference is
 * being described.
 *
 * `spliceMentionPhrase` now collapses the horizontal whitespace on either side
 * of each splice seam — scoped to the seam, so prose the author double-spaced
 * elsewhere is left alone and an already-single-spaced prompt is byte-identical.
 */

const panda: ConnectedReference = {
  id: "c1", defaultName: "Panda", source: "wired-character",
  url: "https://cdn/panda.png", characterSlug: "panda",
}
const panda2: ConnectedReference = {
  id: "n2", defaultName: "Panda2", source: "wired-image", url: "https://cdn/panda2.png",
}
const beach: ConnectedReference = {
  id: "l1", defaultName: "Beach", source: "wired-location",
  url: "https://cdn/beach.png", locationSlug: "beach",
}

const REFS = [panda, panda2, beach]

/** Mention URLs merge character → location → image, so the letters are
 *  A = the character, B = the location, C = the named image. */
const EXPECTED =
  "the person from reference image A and reference image C walking in "
  + "the location from reference image B at dusk"

const build = (prompt: string) => buildImagePrompt({
  prompt,
  connectedReferences: REFS,
  provider: "nano-banana-pro",
  referenceFormat: "hybrid",
}).prompt

describe("mention splice — seam whitespace", () => {
  it("Tal's shape: character + image + location in one sentence, single-spaced throughout", () => {
    expect(build("@panda:1  and @panda2:2  walking in @beach:3  at dusk")).toBe(EXPECTED)
  })

  it("the already-single-spaced prompt is byte-identical (the collapse needs a 2+ run)", () => {
    expect(build("@panda:1 and @panda2:2 walking in @beach:3 at dusk")).toBe(EXPECTED)
  })

  it("collapses on the LEADING side of a seam too", () => {
    expect(build("@panda:1 and  @panda2:2 walking in  @beach:3 at dusk")).toBe(EXPECTED)
  })

  it("never emits a doubled space, whichever side of the chip carries it", () => {
    for (const prompt of [
      "@panda:1  and @panda2:2 walking in @beach:3 at dusk",
      "@panda:1 and  @panda2:2 walking in @beach:3 at dusk",
      "@panda:1   and   @panda2:2   walking in   @beach:3   at dusk",
    ]) {
      expect(build(prompt)).toBe(EXPECTED)
    }
  })

  it("leaves a doubled space the author put in their own prose alone (seam-scoped, not a body tidy)", () => {
    expect(build("@panda:1 walks  slowly past @beach:3")).toBe(
      "the person from reference image A walks  slowly past the location from reference image B",
    )
  })

  it("preserves newlines — the collapse class is horizontal-only", () => {
    expect(build("@panda:1  runs\n\n@beach:3  at dusk")).toBe(
      "the person from reference image A runs\n\nthe location from reference image B at dusk",
    )
  })
})

// The `{image:N:label}` positional pill is a mention chip like any other:
// `buildRefPillNodes` appends its own trailing space to EVERY pill it builds,
// the positional `imageRef` node included. Its hybrid expansion used a raw
// `.replace`, so the same doubled space survived on this path after the three
// `@`-mention resolvers were fixed.
describe("mention splice — the {image:N:label} positional pill", () => {
  const hat: ConnectedReference = {
    id: "n1", defaultName: "Hat", source: "wired-image", url: "https://cdn/hat.png",
  }
  const coat: ConnectedReference = {
    id: "n2", defaultName: "Coat", source: "wired-image", url: "https://cdn/coat.png",
  }
  const buildTokens = (prompt: string, refs: readonly ConnectedReference[]) => buildImagePrompt({
    prompt,
    connectedReferences: [...refs],
    referenceImageUrls: refs.map((r) => r.url!),
    provider: "nano-banana-pro",
    referenceFormat: "hybrid",
  }).prompt

  it("collapses the trailing seam the pill's own space creates", () => {
    expect(buildTokens("a man wearing {image:1:hat}  in the park", [hat])).toBe(
      "A man wearing the hat from reference image A in the park",
    )
  })

  it("the already-single-spaced prompt is byte-identical", () => {
    expect(buildTokens("a man wearing {image:1:hat} in the park", [hat])).toBe(
      "A man wearing the hat from reference image A in the park",
    )
  })

  it("two pills in one sentence both splice cleanly (right-to-left offsets stay valid)", () => {
    expect(buildTokens("a man wearing {image:1:hat}  and  {image:2:coat}  walks", [hat, coat])).toBe(
      "A man wearing the hat from reference image A and the coat from reference image B walks",
    )
  })

  it("leaves a doubled space the author put in their own prose alone", () => {
    expect(buildTokens("{image:1:hat} worn  loosely", [hat])).toBe(
      "The hat from reference image A worn  loosely",
    )
  })

  it("an out-of-range token stays visible, and its whitespace with it", () => {
    expect(buildTokens("a man wearing {image:7:hat}  in the park", [hat])).toContain(
      "{image:7:hat}  in the park",
    )
  })
})

// Indentation is structure, not a seam. A run that OPENS a line is the author's
// layout (a shot list, a numbered beat sheet), so the leading collapse is
// anchored to prose on the same line via `(?<=\S)`. Without that anchor a
// mention starting an indented line flattened the indent to a single space —
// the same class of damage as merging paragraphs, and it would have made the
// "an already-single-spaced prompt is byte-identical" claim false for every
// multi-line prompt.
describe("mention splice — line-initial indentation survives", () => {
  /** One character ref only, so no unmentioned ref appends a canonical phrase
   *  and the assertions can be byte-exact on the multi-line shape. */
  const buildOne = (prompt: string) => buildImagePrompt({
    prompt,
    connectedReferences: [panda],
    provider: "nano-banana-pro",
    referenceFormat: "hybrid",
  }).prompt

  it("a mention that opens an indented line keeps the indent verbatim", () => {
    expect(buildOne("Scene:\n    @panda:1 stands")).toBe(
      "Scene:\n    the person from reference image A stands",
    )
  })

  it("indent preserved AND the trailing seam still collapses on the same mention", () => {
    expect(buildOne("Scene:\n  @panda:1  stands")).toBe(
      "Scene:\n  the person from reference image A stands",
    )
  })

  it("a leading run at the very start of the prompt is indentation too", () => {
    expect(buildOne("   @panda:1  stands")).toBe(
      "   the person from reference image A stands",
    )
  })

  it("mid-line prose before the run still collapses (the anchor is `\\S`, not `^`)", () => {
    expect(buildOne("Scene:\n    a man and  @panda:1 stands")).toBe(
      "Scene:\n    a man and the person from reference image A stands",
    )
  })
})
