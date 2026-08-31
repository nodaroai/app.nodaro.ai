import { describe, it, expect } from "vitest"
import { assembleImageInput } from "../assemble-image-input.js"
import { buildImagePrompt, buildImagePromptWithOverflow } from "../prompt-builder.js"
import { renderDirectionHints, IMAGE_HINT_MODE_DEFAULT } from "../direction-registry.js"
import { joinPromptHints } from "../prompt-hint-join.js"
import { getMaxImagePromptChars } from "@nodaro/shared"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * TRUNCATION ORDERING — `assembleImageInput` sheds its own hint clauses before
 * the provider cap's ORDER-BLIND tail cut can reach anything that matters.
 *
 * The failure this pins (filed as a follow-up on the direction-registry PR): a
 * maximal image-surface `direction` renders ~1.2K characters of clauses, which
 * on a low-cap provider (seedream = 3000) pushes the assembled prompt past the
 * cap. `buildImagePrompt` then cuts the TAIL — and in the hybrid reference
 * format the trailing canonical role phrase ("the location from reference image
 * B") sits AFTER the folded hints, so the cut severs a REFERENCE BINDING while
 * decorative hint clauses survive. The assembler knows which clauses are hints
 * (it just rendered them), so it drops them last-folded-first and re-assembles.
 */

// A broad but ordinary image direction — the kind a "set every picker" UI
// emits. Ids that don't resolve contribute nothing (registry tolerance), which
// is fine: what matters is that the fold is large enough to overflow seedream.
const DIRECTION = {
  shotSize: "wide-shot",
  angle: "low-angle",
  cameraFormat: "16mm-film",
  lens: "wide-24mm",
  isoValue: "iso-100",
  timeOfDay: "golden-hour",
  lightingStyle: "rembrandt",
  colorLook: "teal-orange",
  atmosphere: ["fog"],
  style: "anime",
  mood: ["happy", "joyful"],
  photographer: ["annie-leibovitz"],
  setting: "forest",
} as const

const IMAGE_HINTS = renderDirectionHints(DIRECTION, {
  surface: "image",
  mode: IMAGE_HINT_MODE_DEFAULT,
})

/** The mentioned character — its directive is the FIRST binding in the prompt. */
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

/** An UNMENTIONED wired location — hybrid renders its role phrase at the very
 *  END of the prompt, behind every folded hint. The order-blind casualty. */
const PIER: ConnectedReference = {
  id: "pier-id",
  defaultName: "Pier",
  source: "wired-location",
  url: "https://r2.example/pier.png",
  locationSlug: "pier",
}

/** The mention-resolved character binding, in the middle of the prose. */
const CHARACTER_BINDING = "the person from reference image A"
/** The binding the tail cut destroys when nothing sheds the hints first. */
const LOCATION_BINDING = "the location from reference image B"

/** Prose long enough that prose + directives + the full fold clears 3000. */
const PROSE = "@kira:1 walks the seawall at dusk. " + "The waves are loud. ".repeat(90)

const SEEDREAM_CAP = getMaxImagePromptChars("seedream")

const overCapInput = {
  userPrompt: PROSE,
  provider: "seedream",
  connectedReferences: [KIRA, PIER],
  direction: DIRECTION,
  referenceFormat: "hybrid" as const,
}

describe("assembleImageInput — cap-aware hint shedding", () => {
  it("the unordered fold really does overflow seedream (non-vacuity guard)", () => {
    // The oracle for "what the assembler would have produced before": fold every
    // hint, hand it to the builder, let the tail cut decide. If catalog wording
    // ever shrinks enough that this no longer truncates, the scenario below is
    // vacuous and this assertion says so loudly.
    const naive = buildImagePrompt({
      prompt: joinPromptHints(PROSE, IMAGE_HINTS),
      provider: "seedream",
      connectedReferences: [KIRA, PIER],
      referenceFormat: "hybrid",
    })
    expect(naive.prompt.endsWith("...")).toBe(true)
    // …and what it cut was the reference binding, not the decorative tail.
    expect(naive.prompt).not.toContain(LOCATION_BINDING)
  })

  it("keeps every reference binding and the full prose, dropping trailing hints", () => {
    const result = assembleImageInput(overCapInput)

    // Fits WITHOUT a tail cut — the shed resolved the whole overflow.
    expect(result.prompt.length).toBeLessThanOrEqual(SEEDREAM_CAP)
    expect(result.prompt.endsWith("...")).toBe(false)

    // Both bindings survive: the mention-resolved character phrase inside the
    // prose and the unmentioned location's TRAILING role phrase.
    expect(result.prompt).toContain(CHARACTER_BINDING)
    expect(result.prompt).toContain(LOCATION_BINDING)
    expect(result.referenceImageUrls).toEqual([
      "https://r2.example/kira.png",
      "https://r2.example/pier.png",
    ])

    // The user's prose survives in full (the mention resolves to its binding;
    // the hint join trims the body's trailing space).
    expect(result.prompt).toContain(PROSE.replace("@kira:1", CHARACTER_BINDING).trim())

    // The LAST-folded hint clause is gone; the FIRST-folded one stayed. Shedding
    // walks the fold order from the tail, so the dimensions the registry ranks
    // first outlive the ones it ranks last.
    expect(result.prompt).not.toContain(IMAGE_HINTS[IMAGE_HINTS.length - 1])
    expect(result.prompt).toContain(IMAGE_HINTS[0])
  })

  it("falls back to the builder's clamp when the body overflows on prose alone", () => {
    // Nothing droppable can save a body that blows the cap by itself — the
    // order-blind clamp is still the last resort, unchanged.
    const result = assembleImageInput({
      userPrompt: "x".repeat(SEEDREAM_CAP + 500),
      provider: "seedream",
      direction: DIRECTION,
    })
    expect(result.prompt.length).toBe(SEEDREAM_CAP)
    expect(result.prompt.endsWith("...")).toBe(true)
  })
})

describe("assembleImageInput — under-cap byte parity", () => {
  // The oracle is literally the pre-change implementation: compose every hint,
  // call buildImagePrompt. A prompt that FITS must be byte-identical to it.
  const parityCases: ReadonlyArray<{ name: string; provider: string; prompt: string }> = [
    { name: "high-cap provider with the same maximal fold", provider: "nano-banana-pro", prompt: PROSE },
    { name: "low-cap provider, short prose", provider: "seedream", prompt: "a knight on a hill" },
  ]

  for (const { name, provider, prompt } of parityCases) {
    it(`is byte-identical to the unordered fold — ${name}`, () => {
      const expected = buildImagePrompt({
        prompt: joinPromptHints(prompt, IMAGE_HINTS),
        provider,
        connectedReferences: [KIRA, PIER],
        referenceFormat: "hybrid",
      })
      const actual = assembleImageInput({
        userPrompt: prompt,
        provider,
        connectedReferences: [KIRA, PIER],
        direction: DIRECTION,
        referenceFormat: "hybrid",
      })
      expect(actual).toEqual(expected)
      // Guard the guard: a case that truncated would prove nothing.
      expect(expected.prompt.endsWith("...")).toBe(false)
    })
  }

  it("leaves the no-direction platform-caller path an exact no-op", () => {
    // No hints → nothing droppable → the prompt reaches the builder verbatim
    // and untrimmed, exactly as before, even on the low-cap provider.
    const result = assembleImageInput({ userPrompt: "  a knight  ", provider: "seedream" })
    expect(result.prompt).toBe("  a knight  ")
  })
})

describe("buildImagePromptWithOverflow", () => {
  it("reports 0 and the identical prompt when the assembly fits", () => {
    const config = { prompt: "a knight on a hill", provider: "seedream" }
    const fitted = buildImagePromptWithOverflow(config)
    expect(fitted.overflowChars).toBe(0)
    const { overflowChars, ...result } = fitted
    expect(result).toEqual(buildImagePrompt(config))
  })

  it("reports how many characters the cap forced off the tail", () => {
    const config = { prompt: "x".repeat(SEEDREAM_CAP + 250), provider: "seedream" }
    const fitted = buildImagePromptWithOverflow(config)
    expect(fitted.overflowChars).toBe(250)
    const { overflowChars, ...result } = fitted
    expect(result).toEqual(buildImagePrompt(config))
  })

  it("counts the reserved Style/Avoid suffixes in the overflow", () => {
    // The suffixes are reserved BEFORE the body is cut, so they are part of what
    // must be reclaimed — a caller shedding only `overflowChars` of body still fits.
    const config = {
      prompt: "x".repeat(SEEDREAM_CAP),
      provider: "seedream",
      negativePrompt: "blurry",
    }
    const fitted = buildImagePromptWithOverflow(config)
    expect(fitted.overflowChars).toBe("\nAvoid: blurry".length)
    expect(fitted.prompt.length).toBeLessThanOrEqual(SEEDREAM_CAP)
  })
})
