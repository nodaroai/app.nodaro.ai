import { describe, it, expect } from "vitest"
import { applyVideoNegativePrompt } from "@nodaro/shared"
import type { CharacterDef, ConnectedReference } from "@nodaro/shared"
import { assembleImageInput } from "../assemble-image-input.js"
import { composeVideoPromptText } from "../assemble-video-input.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"

/**
 * WHERE THE `[style]` SECTION ENDS. The section has no terminator and every
 * assembler downstream of the composer appends to the string it returns — the
 * reference resolvers' role phrases and element directives, the legacy
 * character descriptions, `Style:` and `Avoid:`. Line-joined onto a prompt that
 * ENDS with the section, each of them reads as one more look clause under the
 * header, which is exactly the confusion the section exists to remove.
 *
 * BODY content — a reference binding, an element directive, a character
 * description — is SPLICED in ahead of the section instead, where the prose it
 * belongs with already is. The look tail stays last, which is where it was
 * measured to be free.
 *
 * Assertions read the header as a LITERAL and the clause wording through the
 * catalogs, so this suite pins the BOUNDARY, not the catalog copy.
 */

/** The `\n\n`-delimited block the `[style]:` header opens — every line the
 *  model reads as a look clause. `""` when the prompt carries no section. */
const styleBlockOf = (prompt: string): string =>
  prompt.split("\n\n").find((b) => b.startsWith("[style]:")) ?? ""

const LIBRARY: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

const KIRA: ConnectedReference = {
  id: "kira", defaultName: "Kira", source: "wired-character",
  url: "https://cdn/kira.png", characterSlug: "kira",
  characterCanonicalDescription: "a young woman with copper hair",
  variantSlug: undefined, variantDescription: null, variantDisplayName: "canonical",
}

const KIRA_DEF: CharacterDef = {
  id: "kira", name: "Kira", type: "description", category: "character",
  description: "auburn hair, hazel eyes",
}

/** Look on both lines: `style` is a film clause, `shotSize` a scene clause. */
const DIRECTION = { style: "anime", shotSize: "wide-shot" } as const

/** The trailing role phrase a canonical (unmentioned) wired location renders. */
const LOCATION_PHRASE = "the location from reference image A"
/** The video twin, bound to the resolver's `@image_N` shape. */
const CHARACTER_PHRASE = "the person from @image_1"

describe("image assembly — nothing lands under the `[style]` header", () => {
  const hybrid = assembleImageInput({
    userPrompt: "a man walks",
    provider: "nano-banana",
    direction: DIRECTION,
    connectedReferences: [LIBRARY],
    referenceFormat: "hybrid",
    style: "cinematic",
    negativePrompt: "blurry",
  }).prompt

  it("splices the reference binding into the body, ahead of the section", () => {
    // Non-vacuity: the section really is there, carrying both look lines.
    expect(styleBlockOf(hybrid)).toContain("[style]:\n")
    expect(styleBlockOf(hybrid)).toContain("wide shot")

    expect(styleBlockOf(hybrid)).not.toContain(LOCATION_PHRASE)
    expect(hybrid.indexOf(LOCATION_PHRASE)).toBeGreaterThan(-1)
    expect(hybrid.indexOf(LOCATION_PHRASE)).toBeLessThan(hybrid.indexOf("[style]:"))
  })

  it("splices the LEGACY character description into the body too", () => {
    const legacy = assembleImageInput({
      userPrompt: "a man walks",
      provider: "nano-banana",
      direction: DIRECTION,
      characterDefs: [KIRA_DEF],
    }).prompt
    const desc = "Include character 'Kira': auburn hair, hazel eyes."
    expect(legacy).toContain(desc)
    expect(styleBlockOf(legacy)).not.toContain(desc)
    expect(legacy.indexOf(desc)).toBeLessThan(legacy.indexOf("[style]:"))
  })

  it("honors a user-overridden wrapper template while keeping the section last", () => {
    const legacy = assembleImageInput({
      userPrompt: "a man walks",
      provider: "nano-banana",
      direction: DIRECTION,
      characterDefs: [KIRA_DEF],
      userTemplates: { "generate-image-wrapper": "{assetDescriptions} // {userPrompt}" },
    }).prompt
    expect(legacy.startsWith("Include character 'Kira': auburn hair, hazel eyes. // a man walks")).toBe(true)
    expect(styleBlockOf(legacy)).not.toContain("Kira")
  })

  it("keeps the no-section shapes byte-identical (the append fallback)", () => {
    const noSection = assembleImageInput({
      userPrompt: "a man walks",
      provider: "nano-banana",
      connectedReferences: [LIBRARY],
      referenceFormat: "hybrid",
      style: "cinematic",
      negativePrompt: "blurry",
    }).prompt
    expect(noSection).toBe(
      `A man walks\n${LOCATION_PHRASE}\nStyle: cinematic film style, dramatic lighting with cinematic color grading, widescreen aesthetic and film-like depth of field\nAvoid: blurry`,
    )
  })
})

describe("video assembly — nothing lands under the `[style]` header", () => {
  const body = composeVideoPromptText("a knight rides", DIRECTION)
  const framed = resolveVideoReferenceCore({
    prompt: body,
    wiredCharRefs: [KIRA],
    hybridRoles: true,
  }).prompt!

  it("splices the resolver's role phrase ahead of the section, which ends the prompt", () => {
    expect(styleBlockOf(framed)).toContain("[style]:\n")
    expect(styleBlockOf(framed)).not.toContain(CHARACTER_PHRASE)
    expect(framed.indexOf(CHARACTER_PHRASE)).toBeLessThan(framed.indexOf("[style]:"))
    // The look tail really is the tail: nothing follows the section.
    expect(framed.endsWith(styleBlockOf(framed))).toBe(true)
  })

  it("keeps the sectionless `Avoid:` join byte-identical", () => {
    const plain = applyVideoNegativePrompt("a knight rides", "blurry", "seedance-2").prompt
    expect(plain).toBe("a knight rides\nAvoid: blurry")
  })
})
