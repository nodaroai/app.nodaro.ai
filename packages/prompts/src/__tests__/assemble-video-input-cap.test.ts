import { describe, it, expect } from "vitest"
import { composeVideoPromptText } from "../assemble-video-input.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import { renderDirectionHints, VIDEO_HINT_MODE_DEFAULT } from "../direction-registry.js"
import { renderStructuredFields } from "../prompt-builder-structured-fields.js"
import { getMaxVideoPromptChars } from "@nodaro/shared"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * TRUNCATION ORDERING, VIDEO HALF — `composeVideoPromptText` sheds its own hint
 * clauses before the provider clamp's ORDER-BLIND tail cut can reach a
 * reference binding or the user's prose. The image twin is
 * `assemble-image-input-cap.test.ts`; this suite mirrors its shape.
 *
 * THE ORDERING PROBLEM THIS SIDE HAS AND THE IMAGE SIDE DID NOT: the fold runs
 * BEFORE `resolveVideoReferenceCore`, and the resolver then ADDS the binding
 * text — hybrid's role phrases are APPENDED, so they sit behind every folded
 * hint and are the first thing a tail cut destroys. So the shed is decided on
 * the FRAMED length (`opts.frame`), not on the folded body: the resolver's
 * additions are inside the budget, while the only thing the composer can drop
 * is a clause it rendered itself. The frame below is the real resolver.
 *
 * Video caps are far tighter than the image side's (kling = 1000 vs seedream =
 * 3000), so an ordinary direction overflows without any contrived prose.
 */

// A broad but ordinary video direction — the kind a "set every picker" UI emits.
// Ids that don't resolve contribute nothing (registry tolerance); what matters
// is that the fold is large enough to overflow kling.
const DIRECTION = {
  cameraMotion: "handheld",
  shotSize: "wide-shot",
  angle: "low-angle",
  timeOfDay: "golden-hour",
  lightingStyle: "rembrandt",
  colorLook: "teal-orange",
  atmosphere: ["fog"],
  style: "cinematic",
  mood: ["happy", "joyful"],
  setting: "forest",
} as const

const VIDEO_HINTS = renderDirectionHints(DIRECTION, {
  surface: "video",
  mode: VIDEO_HINT_MODE_DEFAULT,
})

/** The mentioned character — hybrid replaces the mention INLINE, mid-prose. */
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

/** An UNMENTIONED wired character — hybrid renders its canonical-fallback role
 *  phrase at the very END, behind every folded hint. The order-blind casualty. */
const RAY: ConnectedReference = {
  id: "ray-id",
  defaultName: "Ray",
  source: "wired-character",
  url: "https://r2.example/ray.png",
  characterSlug: "ray",
  variantSlug: undefined,
  characterCanonicalDescription: "a grizzled dockworker",
  variantDescription: null,
  variantDisplayName: "canonical",
}

const KLING_CAP = getMaxVideoPromptChars("kling")

/** Prose long enough that prose + bindings + the full fold clears 1000. */
const PROSE = "@kira:1 walks the seawall at dusk. " + "The waves are loud. ".repeat(14)

/**
 * The FRAME under test: the production reference resolver in the hybrid format,
 * exactly the shape the routes' `assembleVideoConnectedReferences` drives it in.
 * Pure, so the composer may call it once per shed iteration.
 */
const frame = (body: string | undefined): string | undefined =>
  resolveVideoReferenceCore({
    prompt: body,
    wiredCharRefs: [KIRA, RAY],
    hybridRoles: true,
  }).prompt

/** The binding that lands inline, inside the prose. */
const MENTION_BINDING = "@image_1"
/** Ray is unmentioned → his canonical-fallback phrase is APPENDED, last. */
const TRAILING_BINDING = "@image_2"

describe("composeVideoPromptText — cap-aware hint shedding", () => {
  it("the unshed fold really does overflow kling through the frame (non-vacuity guard)", () => {
    // The oracle for "what the composer produced before": fold every hint, hand
    // the body to the resolver, let the provider clamp decide. If catalog
    // wording ever shrinks enough that this stops overflowing, every scenario
    // below is vacuous and this assertion says so loudly.
    const naive = frame(composeVideoPromptText(PROSE, DIRECTION))!
    expect(naive.length).toBeGreaterThan(KLING_CAP)
    // …and what a tail cut at the cap would destroy is the trailing BINDING,
    // not the decorative tail: the role phrase sits past the cap.
    expect(naive.slice(0, KLING_CAP)).not.toContain(TRAILING_BINDING)
  })

  it("keeps every binding and the full prose, dropping trailing hints", () => {
    const body = composeVideoPromptText(PROSE, DIRECTION, undefined, {
      cap: KLING_CAP,
      frame,
    })!
    const framed = frame(body)!

    // Fits — the shed resolved the whole overflow, so the provider clamp is
    // never reached and nothing is cut mid-word.
    expect(framed.length).toBeLessThanOrEqual(KLING_CAP)

    // Both bindings survive: the mention resolved inline AND the trailing
    // canonical-fallback role phrase the resolver appends last.
    expect(framed).toContain(MENTION_BINDING)
    expect(framed).toContain(TRAILING_BINDING)

    // The user's prose survives IN FULL and still leads the body (the hint join
    // trims its trailing space), and it survives the framing too — the mention
    // resolving inline to its role phrase is the only edit it takes.
    expect(body.startsWith(PROSE.trim())).toBe(true)
    expect(framed).toContain(PROSE.replace("@kira:1", `the person from ${MENTION_BINDING}`).trim())

    // The LAST-folded hint clause is gone; the FIRST-folded one stayed. Shedding
    // walks the fold order from the tail, so the dimensions the registry folds
    // first outlive the ones it folds last.
    expect(body).not.toContain(VIDEO_HINTS[VIDEO_HINTS.length - 1])
    expect(body).toContain(VIDEO_HINTS[0])
  })

  it("sheds more as the cap tightens, and everything at a cap prose alone can't meet", () => {
    const roomy = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: KLING_CAP, frame })!
    const tight = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: 700, frame })!
    expect(tight.length).toBeLessThan(roomy.length)

    // A cap the framed prose alone cannot meet sheds every hint and then stops —
    // prose is never touched, and the provider clamp stays the last resort.
    const starved = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: 10, frame })
    expect(starved).toBe(PROSE)
    for (const hint of VIDEO_HINTS) expect(starved).not.toContain(hint)
  })

  it("reserves the caller's budget rather than re-deriving a provider cap", () => {
    // The routes pass `effectiveVideoPromptCeiling`, which for a NON-native
    // negative provider is `cap - "\nAvoid: …".length`. The composer must honor
    // that reduced number verbatim — a composer that read `getMaxVideoPromptChars`
    // itself would shed too little and let the clamp sever the Avoid suffix's
    // room. `minimax` is outside NATIVE_NEGATIVE_VIDEO_PROVIDERS, so its ceiling
    // really does shrink.
    const rawCap = getMaxVideoPromptChars("minimax")
    const reserved = rawCap - "\nAvoid: blurry, low quality".length
    const atRaw = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: rawCap, frame })!
    const atReserved = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: reserved, frame })!
    expect(frame(atReserved)!.length).toBeLessThanOrEqual(reserved)
    expect(atReserved.length).toBeLessThanOrEqual(atRaw.length)
  })

  it("never sheds the structured fragment — it is user content, not a garnish", () => {
    const structured = { subject: "a lighthouse keeper", action: "hauls a rope hand over hand" }
    const fragment = renderStructuredFields(structured)
    const body = composeVideoPromptText(PROSE, DIRECTION, structured, { cap: 700, frame })!
    expect(body).toContain(fragment)
    // …and it still lands LAST, behind the surviving hints.
    expect(body.endsWith(fragment)).toBe(true)
  })
})

describe("composeVideoPromptText — under-cap byte parity", () => {
  // The oracle is literally the capless call. A framed prompt that FITS must be
  // byte-identical to it, so the whole leg lands dark for every under-cap run.
  const parityCases: ReadonlyArray<{ name: string; provider: string; prompt: string }> = [
    { name: "high-cap provider with the same fold", provider: "seedance-2", prompt: PROSE },
    { name: "low-cap provider, short prose", provider: "kling", prompt: "a knight on a hill" },
  ]

  for (const { name, provider, prompt } of parityCases) {
    it(`is byte-identical to the capless fold — ${name}`, () => {
      const cap = getMaxVideoPromptChars(provider)
      const expected = composeVideoPromptText(prompt, DIRECTION)
      const actual = composeVideoPromptText(prompt, DIRECTION, undefined, { cap, frame })
      expect(actual).toBe(expected)
      // Guard the guard: a case that overflowed would prove nothing.
      expect(frame(expected)!.length).toBeLessThanOrEqual(cap)
    })
  }

  it("leaves the no-direction platform-caller path an exact no-op under a cap", () => {
    // No hints → nothing droppable → the prompt comes back verbatim and
    // UNTRIMMED, `undefined` included, exactly as before, even on a tiny cap.
    expect(composeVideoPromptText("  \n", undefined, undefined, { cap: 1, frame })).toBe("  \n")
    expect(composeVideoPromptText(undefined, undefined, undefined, { cap: 1, frame })).toBeUndefined()
    expect(composeVideoPromptText("a knight", {}, undefined, { cap: 1, frame })).toBe("a knight")
  })

  it("treats an absent frame as identity, and an absent cap as no shedding at all", () => {
    // A caller with a cap but no references measures the body itself…
    const framedless = composeVideoPromptText(PROSE, DIRECTION, undefined, { cap: 400 })!
    expect(framedless.length).toBeLessThanOrEqual(400)
    // …and a caller with no cap gets the full fold no matter how long it is.
    expect(composeVideoPromptText(PROSE, DIRECTION, undefined, { frame })).toBe(
      composeVideoPromptText(PROSE, DIRECTION),
    )
  })
})
