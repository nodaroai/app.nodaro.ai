/**
 * The `subject` fold where it actually lands: `assembleImageInput` (stills) and
 * `composeVideoPromptText` (clips).
 *
 * THE LOAD-BEARING TEST IN THIS FILE is the NO-SUBJECT ORACLE: with no
 * `subject` — which is every caller in the world on the day this ships — the
 * assembled prompt must be byte-for-byte what it was before the channel
 * existed. That is what makes the rollout dark. The oracle is written as an
 * independent recomputation (`joinPromptHints` over `renderDirectionHints`),
 * not as a snapshot, so it keeps testing the claim if the catalogs change.
 */
import { describe, it, expect } from "vitest"
import { assembleImageInput } from "../assemble-image-input.js"
import { composeVideoPromptText } from "../assemble-video-input.js"
import { buildImagePrompt } from "../prompt-builder.js"
import { joinPromptHints, PROMPT_HINT_SEPARATOR } from "../prompt-hint-join.js"
import { renderDirectionHints, IMAGE_HINT_MODE_DEFAULT, VIDEO_HINT_MODE_DEFAULT } from "../direction-registry.js"
import {
  renderSubjectHints,
  SUBJECT_IMAGE_HINT_MODE_DEFAULT,
  SUBJECT_VIDEO_HINT_MODE_DEFAULT,
} from "../subject-registry.js"
import { getMaxImagePromptChars } from "@nodaro/shared"
import type { ConnectedReference } from "@nodaro/shared"

const DIRECTION = {
  shotSize: "wide-shot",
  timeOfDay: "golden-hour",
  lens: "wide-24mm",
  style: "anime",
} as const

const SUBJECT = {
  type: "woman",
  ethnicity: "east-asian",
  hairBase: "base-short-straight",
  makeup: "makeup-smoky",
  animal: "dog-corgi",
} as const

const STRUCTURED = { person: { age: 34, hair: "auburn" } } as const

const KIRA: ConnectedReference = {
  id: "kira-id",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2.example/kira.png",
  characterSlug: "kira",
  variantSlug: undefined,
  characterCanonicalDescription: "a young woman with copper hair",
  variantDescription: null,
  variantDisplayName: "canonical",
}

describe("the no-subject oracle — the fold is dark until a caller opts in", () => {
  const cases: ReadonlyArray<{ name: string; input: Parameters<typeof assembleImageInput>[0] }> = [
    {
      name: "bare prompt (the exact no-op contract, untrimmed)",
      input: { userPrompt: "  a knight on a hill  ", provider: "nano-banana" },
    },
    {
      name: "direction only",
      input: { userPrompt: "a knight on a hill", provider: "nano-banana", direction: DIRECTION },
    },
    {
      name: "structured only",
      input: { userPrompt: "a knight on a hill", provider: "nano-banana", structured: STRUCTURED },
    },
    {
      name: "direction + structured + a bound reference",
      input: {
        userPrompt: "@kira:1 on a hill",
        provider: "nano-banana",
        connectedReferences: [KIRA],
        direction: DIRECTION,
        structured: STRUCTURED,
      },
    },
  ]

  for (const { name, input } of cases) {
    it(`is unchanged by the channel's existence — ${name}`, () => {
      const withNothing = assembleImageInput(input)
      // An explicitly-undefined subject, an empty bag, and a bag of keys the
      // platform does not know are all the same as not passing one.
      expect(assembleImageInput({ ...input, subject: undefined })).toEqual(withNothing)
      expect(assembleImageInput({ ...input, subject: {} })).toEqual(withNothing)
      expect(assembleImageInput({ ...input, subject: { notAField: "x" } })).toEqual(withNothing)
    })
  }

  it("returns the user's prompt VERBATIM AND UNTRIMMED with no lever at all", () => {
    const userPrompt = "  a knight on a hill  "
    expect(assembleImageInput({ userPrompt, provider: "nano-banana" }).prompt).toBe(userPrompt)
  })

  it("matches an independent recomputation of the direction-only fold", () => {
    const userPrompt = "a knight on a hill"
    const expected = buildImagePrompt({
      prompt: joinPromptHints(
        userPrompt,
        renderDirectionHints(DIRECTION, { surface: "image", mode: IMAGE_HINT_MODE_DEFAULT }),
      ),
      provider: "nano-banana",
    })
    expect(assembleImageInput({ userPrompt, provider: "nano-banana", direction: DIRECTION })).toEqual(
      expected,
    )
  })

  it("leaves the video composer's no-op contract intact (undefined stays undefined)", () => {
    expect(composeVideoPromptText(undefined, undefined)).toBeUndefined()
    expect(composeVideoPromptText(undefined, undefined, undefined, { subject: {} })).toBeUndefined()
    expect(
      composeVideoPromptText(undefined, undefined, undefined, { subject: { notAField: "x" } }),
    ).toBeUndefined()
    expect(composeVideoPromptText("  a clip  ", undefined, undefined, { subject: {} })).toBe(
      "  a clip  ",
    )
  })
})

describe("the subject fold — position and content", () => {
  it("lands the subject clauses AHEAD of the direction clauses", () => {
    const userPrompt = "on the seawall"
    const subjectHints = renderSubjectHints(SUBJECT, {
      surface: "image",
      mode: SUBJECT_IMAGE_HINT_MODE_DEFAULT,
    })
    const directionHints = renderDirectionHints(DIRECTION, {
      surface: "image",
      mode: IMAGE_HINT_MODE_DEFAULT,
    })
    const result = assembleImageInput({
      userPrompt,
      provider: "nano-banana",
      subject: SUBJECT,
      direction: DIRECTION,
    })
    expect(result.prompt).toBe(
      buildImagePrompt({
        prompt: joinPromptHints(userPrompt, [...subjectHints, ...directionHints]),
        provider: "nano-banana",
      }).prompt,
    )
    expect(result.prompt.indexOf(subjectHints[0]!)).toBeLessThan(
      result.prompt.indexOf(directionHints[0]!),
    )
  })

  it("joins person and styling as ONE clause each, not N sentence fragments", () => {
    const result = assembleImageInput({
      userPrompt: "on the seawall",
      provider: "nano-banana",
      subject: { type: "woman", ethnicity: "east-asian", makeup: "makeup-smoky" },
    })
    // Three catalog fragments, but only ONE sentence separator from the person
    // clause: the person row comma-joins its own fragments.
    const sentences = result.prompt.split(PROMPT_HINT_SEPARATOR)
    expect(sentences).toHaveLength(3) // prose. person clause. styling clause.
    expect(sentences[1]).toContain(", ")
  })

  it("folds the subject on the video surface, compact, ahead of direction", () => {
    const composed = composeVideoPromptText("she walks", DIRECTION, undefined, { subject: SUBJECT })
    expect(composed).toBe(
      joinPromptHints("she walks", [
        ...renderSubjectHints(SUBJECT, {
          surface: "video",
          mode: SUBJECT_VIDEO_HINT_MODE_DEFAULT,
        }),
        ...renderDirectionHints(DIRECTION, { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT }),
      ]),
    )
  })

  it("honors an explicit subject verbosity override", () => {
    const full = composeVideoPromptText("she walks", undefined, undefined, {
      subject: SUBJECT,
      subjectHintMode: "full",
    })
    const compact = composeVideoPromptText("she walks", undefined, undefined, { subject: SUBJECT })
    expect(full).not.toBe(compact)
    expect(full!.length).toBeGreaterThan(compact!.length)
  })
})

describe("the subject fold — under the provider cap", () => {
  const SEEDREAM_CAP = getMaxImagePromptChars("seedream")
  // A broad direction fold plus a broad subject fold, on prose long enough that
  // the three together clear the lowest cap in the catalog.
  const BIG_DIRECTION = {
    ...DIRECTION,
    angle: "low-angle",
    cameraFormat: "16mm-film",
    isoValue: "iso-100",
    lightingStyle: "rembrandt",
    colorLook: "teal-orange",
    atmosphere: ["fog"],
    mood: ["happy", "joyful"],
    photographer: ["annie-leibovitz"],
    setting: "forest",
  } as const
  const PROSE = "She walks the seawall at dusk. " + "The waves are loud. ".repeat(90)

  it("sheds the direction fold BEFORE the subject fold", () => {
    const subjectHints = renderSubjectHints(SUBJECT, {
      surface: "image",
      mode: SUBJECT_IMAGE_HINT_MODE_DEFAULT,
    })
    const directionHints = renderDirectionHints(BIG_DIRECTION, {
      surface: "image",
      mode: IMAGE_HINT_MODE_DEFAULT,
    })
    // Non-vacuity: the un-shed fold really does overflow.
    expect(
      joinPromptHints(PROSE, [...subjectHints, ...directionHints]).length,
    ).toBeGreaterThan(SEEDREAM_CAP)

    const result = assembleImageInput({
      userPrompt: PROSE,
      provider: "seedream",
      subject: SUBJECT,
      direction: BIG_DIRECTION,
    })
    expect(result.prompt.length).toBeLessThanOrEqual(SEEDREAM_CAP)
    expect(result.prompt.endsWith("...")).toBe(false)
    // Who is in the shot outlived how it was lit.
    expect(result.prompt).toContain(subjectHints[0])
    expect(result.prompt).not.toContain(directionHints[directionHints.length - 1])
  })
})
