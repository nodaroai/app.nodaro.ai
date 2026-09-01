import { describe, it, expect } from "vitest"
import { composeVideoPromptText } from "../assemble-video-input.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import { renderDirectionHints, VIDEO_HINT_MODE_DEFAULT } from "../direction-registry.js"
import { renderSubjectHints, SUBJECT_VIDEO_HINT_MODE_DEFAULT } from "../subject-registry.js"
import { renderStructuredFields } from "../prompt-builder-structured-fields.js"
import { composeSectionedPrompt, partitionStyleClauses } from "../prompt-style-section.js"
import { joinPromptHints } from "../prompt-hint-join.js"
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

/** The same clauses, slotted — the shed keeps a PREFIX of exactly this list. */
const DIRECTION_CLAUSES = partitionStyleClauses(DIRECTION, {
  surface: "video",
  mode: VIDEO_HINT_MODE_DEFAULT,
})

/** Everything before the `[style]` section — the half the shed budget grows. */
const bodyOf = (composed: string): string => composed.split("\n\n[style]:\n")[0]!

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
    // A FULL shed takes the header with it — byte-identical to the prompt, not
    // an empty section hanging off it. This is what keeps the routes'
    // `composed !== prompt` guard reading false when nothing survived.
    expect(starved).not.toContain("[style]")
  })

  it("reclaims the header only when the LAST look clause sheds", () => {
    // Budgets derived from what the composer actually builds, so they track
    // catalog wording instead of pinning it.
    const capForKept = (n: number): number =>
      frame(composeSectionedPrompt(PROSE, DIRECTION_CLAUSES.slice(0, n), ""))!.length
    // The first clause is `cameraMotion` (motion → body), the second the first
    // LOOK clause — so `kept = 2` is "body plus exactly one section clause".
    expect(DIRECTION_CLAUSES[0]!.slot).toBe("body")
    expect(DIRECTION_CLAUSES[1]!.slot).not.toBe("body")

    const atTwo = composeVideoPromptText(PROSE, DIRECTION, undefined, {
      cap: capForKept(2),
      frame,
    })!
    expect(atTwo).toBe(composeSectionedPrompt(PROSE, DIRECTION_CLAUSES.slice(0, 2), ""))
    expect(atTwo).toContain("[style]:")

    // ONE byte tighter, and the section's last clause goes — taking the whole
    // 11-byte `"\n\n[style]:\n"` with it, so the body drops all the way back to
    // the prose. (The cost of under-pricing that header instead shows up as an
    // over-shed in "sheds the whole direction fold before a single subject
    // clause" below, which is where a flat per-clause charge fails.)
    const justUnder = composeVideoPromptText(PROSE, DIRECTION, undefined, {
      cap: capForKept(2) - 1,
      frame,
    })!
    expect(justUnder).toBe(composeSectionedPrompt(PROSE, DIRECTION_CLAUSES.slice(0, 1), ""))
    expect(justUnder).not.toContain("[style]")
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
    const structured = { person: { profession: "a lighthouse keeper", expression: "focused" } }
    const fragment = renderStructuredFields(structured)
    expect(fragment.length, "an empty fragment makes every claim below vacuous").toBeGreaterThan(0)
    const body = composeVideoPromptText(PROSE, DIRECTION, structured, { cap: 700, frame })!
    expect(body).toContain(fragment)
    // …and it still ends the BODY, behind every surviving body hint.
    expect(bodyOf(body).endsWith(fragment)).toBe(true)
  })

  it("ends the BODY with the fragment even when the section survives above it", () => {
    // The capless fold, where every clause lives: the fragment is the last
    // thing in the body and the section reads after it, so the composed prompt
    // does NOT end with the fragment any more.
    const structured = { person: { profession: "a lighthouse keeper", expression: "focused" } }
    const fragment = renderStructuredFields(structured)
    const body = composeVideoPromptText(PROSE, DIRECTION, structured)!
    expect(body).toContain("\n\n[style]:\n")
    expect(bodyOf(body).endsWith(fragment)).toBe(true)
    expect(body.endsWith(fragment)).toBe(false)
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

/**
 * THE SUBJECT CHANNEL UNDER THE SAME CAP. The decision this pins: subject
 * clauses ARE shed candidates, exactly like direction clauses — both are
 * catalog decoration the platform rendered from ids — and they shed AFTER the
 * direction fold, because both channels ride ONE list (`[...subject,
 * ...direction]`) that the shared `hint-shedding.ts` arithmetic walks TAIL
 * FIRST. Exempting the subject fold would not save it: a fully specified person
 * is the largest single fold on the surface, so the overflow would simply land
 * in the provider's order-blind clamp and sever a binding or the prose instead.
 *
 * The image twin of this ordering is pinned in `subject-fold.test.ts`; what is
 * new HERE is the composition the video surface only gained once the cap and
 * the subject channel met — including the SUBJECT-ONLY fold, which neither
 * channel's own suite exercises under a cap.
 *
 * Caps are derived from the framed body rather than hardcoded, so the cases
 * keep testing the claim when catalog wording changes.
 */
describe("composeVideoPromptText — the subject fold under the cap", () => {
  const SUBJECT = {
    type: "woman",
    ethnicity: "east-asian",
    hairBase: "base-short-straight",
    makeup: "makeup-smoky",
    animal: "dog-corgi",
  } as const

  const SUBJECT_HINTS = renderSubjectHints(SUBJECT, {
    surface: "video",
    mode: SUBJECT_VIDEO_HINT_MODE_DEFAULT,
  })

  /**
   * Framed length of the body that folds exactly the first `n` subject clauses
   * and no direction at all — i.e. the tightest budget under which the shed
   * should settle on `n` kept clauses. Built the same way the composer builds
   * it, so the derived caps track catalog wording instead of pinning it.
   */
  const framedWithSubjectClauses = (n: number): number =>
    frame(n === 0 ? PROSE : joinPromptHints(PROSE, SUBJECT_HINTS.slice(0, n)))!.length

  it("sheds the whole direction fold before a single subject clause", () => {
    // Non-vacuity: subject + direction together really do overflow the frame.
    const unshed = frame(
      composeVideoPromptText(PROSE, DIRECTION, undefined, { subject: SUBJECT }),
    )!
    expect(unshed.length).toBeGreaterThan(KLING_CAP)
    expect(SUBJECT_HINTS.length).toBeGreaterThan(1)

    // A budget that fits the prose plus the FULL subject fold and nothing else.
    const cap = framedWithSubjectClauses(SUBJECT_HINTS.length)
    const body = composeVideoPromptText(PROSE, DIRECTION, undefined, {
      subject: SUBJECT,
      cap,
      frame,
    })!
    expect(frame(body)!.length).toBeLessThanOrEqual(cap)
    // Every subject clause survived; the direction fold paid the whole bill.
    for (const hint of SUBJECT_HINTS) expect(body).toContain(hint)
    for (const hint of VIDEO_HINTS) expect(body).not.toContain(hint)
    // …and the prose and both bindings are untouched, as always.
    expect(body.startsWith(PROSE.trim())).toBe(true)
    expect(frame(body)!).toContain(MENTION_BINDING)
    expect(frame(body)!).toContain(TRAILING_BINDING)
  })

  it("then sheds subject clauses too, last-folded first, once direction is gone", () => {
    // Tighter than the prose plus the full subject fold → the tail of the
    // SUBJECT list has to go as well. This is the decision: subject clauses are
    // shed candidates, not a protected channel.
    const cap = framedWithSubjectClauses(SUBJECT_HINTS.length - 1)
    const body = composeVideoPromptText(PROSE, DIRECTION, undefined, {
      subject: SUBJECT,
      cap,
      frame,
    })!
    expect(frame(body)!.length).toBeLessThanOrEqual(cap)
    expect(body).not.toContain(SUBJECT_HINTS[SUBJECT_HINTS.length - 1])
    expect(body).toContain(SUBJECT_HINTS[0])
  })

  it("sheds a SUBJECT-ONLY fold, and still never the prose or the bindings", () => {
    // The composition neither parent shipped: `subject` with a cap and no
    // `direction` at all — the shape a subject-only route request takes.
    const cap = framedWithSubjectClauses(0)
    const body = composeVideoPromptText(PROSE, undefined, undefined, {
      subject: SUBJECT,
      cap,
      frame,
    })!
    // Everything droppable is gone, so the body is the prose VERBATIM (the
    // `kept === 0` no-op branch), which is what leaves the route's
    // `composed !== prompt` guard correctly unpinned.
    expect(body).toBe(PROSE)
    for (const hint of SUBJECT_HINTS) expect(body).not.toContain(hint)
    const framed = frame(body)!
    expect(framed).toContain(MENTION_BINDING)
    expect(framed).toContain(TRAILING_BINDING)
  })

  it("never sheds the structured fragment to save a subject clause", () => {
    // Ordering across ALL THREE pieces at once: user content outranks both
    // catalog channels and still lands last.
    const structured = { person: { profession: "a lighthouse keeper", expression: "focused" } }
    const fragment = renderStructuredFields(structured)
    const body = composeVideoPromptText(PROSE, DIRECTION, structured, {
      subject: SUBJECT,
      cap: framedWithSubjectClauses(0),
      frame,
    })!
    expect(bodyOf(body).endsWith(fragment)).toBe(true)
    for (const hint of [...SUBJECT_HINTS, ...VIDEO_HINTS]) {
      expect(body).not.toContain(hint)
    }
    // Everything droppable went, so there is no section left to end with.
    expect(body).not.toContain("[style]")
  })

  it("is byte-identical to the capless subject fold when it fits", () => {
    // The under-cap parity oracle, extended to the subject channel: a fold that
    // fits must not be able to tell it was budgeted.
    const short = "a knight on a hill"
    const cap = getMaxVideoPromptChars("seedance-2")
    const expected = composeVideoPromptText(short, DIRECTION, undefined, { subject: SUBJECT })
    const actual = composeVideoPromptText(short, DIRECTION, undefined, {
      subject: SUBJECT,
      cap,
      frame,
    })
    expect(actual).toBe(expected)
    expect(frame(expected)!.length).toBeLessThanOrEqual(cap)
  })

  it("leaves a subject-less request byte-identical under a cap (the parity oracle)", () => {
    // The channel must stay dark: no `subject` → exactly what the direction-only
    // cap path produced before the two met.
    for (const cap of [KLING_CAP, 700, 10]) {
      expect(composeVideoPromptText(PROSE, DIRECTION, undefined, { cap, frame })).toBe(
        composeVideoPromptText(PROSE, DIRECTION, undefined, { subject: {}, cap, frame }),
      )
    }
  })
})
