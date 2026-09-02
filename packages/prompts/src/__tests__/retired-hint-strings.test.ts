import { describe, it, expect } from "vitest"
import { getAdultOnlyHintStrings, RETIRED_ADULT_ONLY_HINT_STRINGS } from "../age-floor.js"

/**
 * W1-b (spec 2026-09-01 §3.3) rewords 17 catalog hints that W1-a (PR 2) had
 * flagged `adultOnly`. The backend `minor-age-floor` policy strips sentences
 * by STRING, so a rewording silently narrows the floor for every consumer
 * still on the pre-rephrase `@nodaro/prompts` — including person.nodaro.ai,
 * whose client-assembled `seedPrompt` is precisely how the 2026-07-30 P0
 * prompts carried `state-fitted`'s clause to the provider.
 *
 * The retired strings therefore stay in the strip set forever. A retired
 * string can only over-strip, and only for a subject already judged a minor.
 */
describe("retired adult-only wording stays inside the floor", () => {
  it("every retired string is still returned by getAdultOnlyHintStrings()", () => {
    const live = new Set(getAdultOnlyHintStrings())
    const missing = RETIRED_ADULT_ONLY_HINT_STRINGS.filter((s) => !live.has(s.toLowerCase()))
    expect(missing, "retired strings dropped out of the floor").toEqual([])
  })

  it("the 2026-07-30 incident clause is in the set by name", () => {
    expect(getAdultOnlyHintStrings()).toContain(
      "the clothing fitted and form-conscious, hugging the contours of the body",
    )
    expect(getAdultOnlyHintStrings()).toContain("wearing a cropped style, midriff and navel visible")
    expect(getAdultOnlyHintStrings()).toContain("with lips slightly parted, taking a soft breath")
  })

  it("the NEW wording is a live needle too — the floor tracks the rephrase forward", () => {
    // The derivation makes this true by construction, but nothing else states
    // it: a future edit that drops a hint under the `length >= 8` filter, or
    // an entry quietly losing `adultOnly`, would narrow the floor silently.
    // (Green only after Task 5; see that task's Step 7 run set.)
    const strings = getAdultOnlyHintStrings()
    expect(strings).toContain("tailored, close-fitting clothing")
    expect(strings).toContain("with a cropped hemline")
  })

  it("no bare derived TERM leaked into the needle set (the promptHint-only contract)", () => {
    const strings = getAdultOnlyHintStrings()
    for (const t of ["lounging", "cropped top", "school uniform", "lying down", "wet clothing", "bare shoulders"]) {
      expect(strings, `term "${t}" must never be a needle`).not.toContain(t)
    }
  })

  it("every retired string is lower-case and long enough to survive the length filter", () => {
    for (const s of RETIRED_ADULT_ONLY_HINT_STRINGS) {
      expect(s, s).toBe(s.toLowerCase())
      expect(s.length, s).toBeGreaterThanOrEqual(8)
    }
  })

  it("the set covers all 15 flagged rephrased entries plus the fold literal", () => {
    // 15 flagged promptHints (the 14 flagged person/styling entries plus the
    // pose twin) + the hard-coded fold literal = 16. `promptHint`s only —
    // never terms. A change to the count must be a deliberate edit here, not
    // a silent drift.
    expect(RETIRED_ADULT_ONLY_HINT_STRINGS.length).toBe(16)
  })

  it("the list is longest-first, matching getAdultOnlyHintStrings' contract", () => {
    const strings = getAdultOnlyHintStrings()
    for (let i = 1; i < strings.length; i++) {
      expect(strings[i - 1].length).toBeGreaterThanOrEqual(strings[i].length)
    }
  })
})
