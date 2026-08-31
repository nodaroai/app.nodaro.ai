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
