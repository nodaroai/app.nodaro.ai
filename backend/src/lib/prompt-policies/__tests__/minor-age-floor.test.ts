import { describe, it, expect, afterEach } from "vitest"
import { applyPromptPolicies, clearPromptPolicies } from "../../prompt-policy.js"
import { registerMainlinePromptPolicies, applyMinorAgeFloorToPrompt, MODEST_ATTIRE_CLAUSE } from "../index.js"

afterEach(() => clearPromptPolicies())

/** The 2026-07-30 incident prompt, re-assembled from its picker values (never
 *  the stored prompt). The styling clause sits INSIDE the free text, exactly
 *  as it arrived from the client — that is the path Layer 1 cannot reach. */
const P0 =
  "a boy-next-door type — friendly, approachable, with wholesome charm, a young child around 5 years old, of European descent, slim, lean build, " +
  "with lips slightly parted, taking a soft breath, with baby-soft, fine-pored, youthful smooth skin, staring directly at the camera with unbroken eye contact, " +
  "wearing a fitted plain crewneck t-shirt with short sleeves, wearing soft matte cotton with a natural woven texture, the clothing fitted and form-conscious, hugging the contours of the body. " +
  "4k portrait, plain background, studio lighting, neutral expression unless described otherwise, fully clothed in simple everyday attire unless the outfit is otherwise described, no text, no labels, no watermarks."

describe("applyMinorAgeFloorToPrompt", () => {
  it("strips every clause carrying a flagged hint string and appends the modest clause once", () => {
    const out = applyMinorAgeFloorToPrompt(P0)
    expect(out).not.toMatch(/hugging the contours|lips slightly parted|soft breath/i)
    expect(out).toContain("a young child around 5 years old")
    expect(out).toContain("wearing a fitted plain crewneck t-shirt")
    expect(out).toContain(MODEST_ATTIRE_CLAUSE)
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    // The self-disabling default is replaced, not stacked.
    expect(out).not.toContain("unless the outfit is otherwise described")
  })

  it("is idempotent", () => {
    const once = applyMinorAgeFloorToPrompt(P0)
    expect(applyMinorAgeFloorToPrompt(once)).toBe(once)
  })

  it("keeps a prompt with nothing to strip intact except for the appended clause", () => {
    const out = applyMinorAgeFloorToPrompt("a child around 8 years old, brown hair, a red raincoat.")
    expect(out).toBe(`a child around 8 years old, brown hair, a red raincoat. ${MODEST_ATTIRE_CLAUSE}.`)
  })

  // The reference-aware self-disabling floor (CLOTHED_MATCH_REFERENCES in
  // character-prompts.ts) — asset-route renders that condition on reference
  // images use this variant instead of CLOTHED_DEFAULT. It must be stripped
  // too, not just the plain "simple everyday attire" default the P0 exercises.
  it("strips the reference-aware self-disabling floor (CLOTHED_MATCH_REFERENCES)", () => {
    const prompt =
      "a child around 7 years old, brown hair, wearing the same outfit as shown in the reference images unless a different outfit is described; " +
      "if no outfit is visible or described, fully clothed in simple everyday attire, no text, no watermarks."
    const out = applyMinorAgeFloorToPrompt(prompt)
    expect(out).not.toContain("if no outfit is visible or described")
    expect(out).not.toContain("same outfit as shown in the reference images")
    expect(out).toContain("a child around 7 years old")
    expect(out).toContain(MODEST_ATTIRE_CLAUSE)
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })

  // Fix round 1, item 2 (CRITICAL) — the review's bypass: the old early return
  // on `prompt.includes(MODEST_ATTIRE_CLAUSE)` skipped stripping ENTIRELY
  // whenever a modest clause already sat anywhere in the text, so flagged
  // wording placed BEFORE a (spoofed or already-appended) modest clause
  // survived untouched. Stripping must always run first; the clause is
  // appended only if still absent afterward.
  it("never bypasses stripping just because the modest clause is already present somewhere in the text", () => {
    const bypassAttempt =
      "a young child around 5 years old, the clothing fitted and form-conscious, hugging the contours of the body, " +
      `with lips slightly parted, taking a soft breath. ${MODEST_ATTIRE_CLAUSE}.`
    const out = applyMinorAgeFloorToPrompt(bypassAttempt)
    expect(out).not.toMatch(/hugging the contours|lips slightly parted|soft breath/i)
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    const twice = applyMinorAgeFloorToPrompt(out)
    expect(twice).toBe(out)
  })

  // Fix round 1, item 3 — word-boundary guards. A needle may only match a
  // whole word/phrase, never glue onto an adjacent word's characters.
  it("does not match inside unrelated compound words", () => {
    const out = applyMinorAgeFloorToPrompt("mesh tops and cybernetic implants")
    expect(out).toContain("mesh tops and cybernetic implants")
  })

  // Fix round 1, item 4 (superseded by fix round 2 — see below): in-place
  // deletion of just the matched needle span leaves surrounding connective
  // words behind as debris. The round-1 fix (whole-clause drop) over-corrected
  // this — see the "bounded hybrid" tests below — but the ORIGINAL requirement
  // this test pins still holds: no dangling "wearing a" (the needle's own
  // lead-in), the needle text itself is gone, and the surrounding content
  // (subject, "holding a book") survives. Fix round 2 no longer guarantees
  // that unrelated trailing debris ("seen", "while smiling" — words that
  // aren't the needle's OWN immediately-preceding connector) is also swept;
  // only the connector immediately adjacent to the needle is removed, by
  // design, so the subject in a case like this never gets dropped with it.
  it("removes a mid-clause needle and its own lead-in connector without dropping the clause's other content", () => {
    const out = applyMinorAgeFloorToPrompt(
      "a young child, seen wearing a fitted bra-style top with the midriff exposed while smiling, holding a book.",
    )
    expect(out).not.toMatch(/bra-style top|midriff exposed|wearing a/i)
    expect(out).toContain("a young child")
    expect(out).toContain("holding a book")
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })

  // A prompt that is ENTIRELY the flagged clause (no other content) must not
  // leave a leading orphan terminator once the sole clause is dropped.
  it("does not leave a leading stray terminator when the whole prompt is one flagged clause", () => {
    const out = applyMinorAgeFloorToPrompt("in a matching lingerie set.")
    expect(out).toBe(`${MODEST_ATTIRE_CLAUSE}.`)
  })

  // Dropping a clause sandwiched between two sentences must not leave a
  // doubled "." behind.
  it("does not leave a doubled full stop when a whole sentence is dropped", () => {
    const out = applyMinorAgeFloorToPrompt("soft fine-pored skin. with lips slightly parted, taking a soft breath. reading.")
    expect(out).not.toContain(". .")
    expect(out).toContain("soft fine-pored skin.")
    expect(out).toContain("reading.")
  })

  // --- Fix round 2: bounded hybrid clause repair ---
  //
  // Whole-clause drop (fix round 1) over-corrected: when a needle shares its
  // clause with the SUBJECT (no comma between them — a comma-internal needle
  // match consumes its own internal comma, so the needle plus everything
  // around it up to the next real comma/period is ONE clause), dropping the
  // whole clause lost the subject and age along with the flagged wording.
  // The repair: strip the needle + at most one immediately-preceding
  // connector word, strip a newly-dangling leading connector, and only drop
  // the clause if fewer than 2 word tokens remain.

  // The needle ("with lips slightly parted, taking a soft breath" —
  // lip-state-parted's real promptHint) IS the entire rest of the clause once
  // its own internal comma is consumed by the match, so there is no separate
  // comma between the subject and the needle. Whole-clause drop would lose
  // "a child around 7 years old" too; the bounded repair keeps it.
  it("keeps the subject and age when the needle shares their clause with no comma between them", () => {
    const out = applyMinorAgeFloorToPrompt("a child around 7 years old with lips slightly parted, taking a soft breath")
    expect(out).toBe(`a child around 7 years old. ${MODEST_ATTIRE_CLAUSE}.`)
  })

  // Same shape, but with real trailing content after the needle's clause
  // boundary ("holding a balloon" is its own clause, untouched either way) —
  // pins that the subject clause is repaired (not dropped) and the sibling
  // clause survives unchanged.
  //
  // Deviation: the coordinator's illustrative input for this case was "a
  // child around 7 years old with lips slightly parted, holding a balloon" —
  // "with lips slightly parted" WITHOUT its ", taking a soft breath"
  // continuation matches no current promptHint (the only catalog entry for
  // that wording is lip-state-parted's full hint, which requires the breath
  // continuation; a bare "lips slightly parted" was the `term` field Commit A
  // deliberately stopped sweeping). Substituted a real short, continuation-free
  // needle — outfit-bikini's promptHint "in a two-piece bikini" — that
  // reproduces the identical shape (needle immediately after the subject
  // clause, no preceding connector word since "in" is inside the needle
  // itself) and lands on the coordinator's exact stated output.
  it("keeps the subject and age plus real trailing content when the needle sits before a comma", () => {
    const out = applyMinorAgeFloorToPrompt("a child around 7 years old in a two-piece bikini, holding a balloon.")
    expect(out).toBe(`a child around 7 years old, holding a balloon. ${MODEST_ATTIRE_CLAUSE}.`)
  })

  // A prompt that IS the needle, with nothing else at all: fewer than 2 word
  // tokens remain after the needle is stripped, so the clause is dropped and
  // only the modest clause remains — the drop side of the keep/drop threshold.
  it("drops a clause that is entirely the flagged needle, leaving only the modest clause", () => {
    const out = applyMinorAgeFloorToPrompt("the clothing fitted and form-conscious, hugging the contours of the body")
    expect(out).toBe(`${MODEST_ATTIRE_CLAUSE}.`)
  })

  // Exercises BOTH connector rules in one clause: "with NEEDLE" removes the
  // needle plus its own immediately-preceding connector ("with"), which then
  // leaves "and a soft smile" — a newly-dangling leading connector ("and")
  // that step 2 strips, surfacing "a soft smile" as real surviving content.
  //
  // Deviation: the coordinator's illustrative "with lips slightly parted and
  // a soft smile" has the same no-current-needle problem as the case above.
  // Substituted hips-narrow's real promptHint "narrow hips" (short,
  // continuation-free, adultOnly) preceded by "with" and followed by "and a
  // soft smile" — reproduces the identical two-connector-rule shape.
  // ───────────────────────────────────────────────────────────────────────
  // Final review, item 4: the alternation was a LITERAL join of the catalog
  // hints, so a phrase the writer re-spaced or hyphenated slipped past the
  // strip entirely — the modest clause still landed (subjectMinor was true),
  // but the flagged wording it exists to remove went to the provider intact.
  // The shared builder (@nodaro/prompts `buildNeedleAlternationSource`) joins
  // each needle's tokens with `[\s-]+`, so the match is on the phrase, not on
  // its spacing. "very full bust" is bust-very-full's real promptHint.
  // ───────────────────────────────────────────────────────────────────────
  it("strips a flagged needle whose separators were widened to extra whitespace", () => {
    const out = applyMinorAgeFloorToPrompt("a young child around 5 years old,  very   full    bust")
    expect(out).not.toMatch(/very\s*full\s*bust|full\s*bust/i)
    expect(out).toContain("a young child around 5 years old")
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })

  it("strips a flagged needle whose separators were written as hyphens", () => {
    const out = applyMinorAgeFloorToPrompt("a young child around 5 years old, very-full bust")
    expect(out).not.toMatch(/very-?\s*full\s*bust|full\s*bust/i)
    expect(out).toContain("a young child around 5 years old")
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })

  // The tolerance must not widen into a substring rule: with no separator at
  // all there is no phrase to match, and the text stays where the user put it.
  it("does not strip a run-together lookalike with no separator", () => {
    const out = applyMinorAgeFloorToPrompt("a child around 7 years old, very fullbust styling.")
    expect(out).toContain("very fullbust styling")
  })

  it("strips both a leading connector and a newly-dangling one, keeping unrelated survivor text", () => {
    const out = applyMinorAgeFloorToPrompt("a child around 7 years old, with narrow hips and a soft smile, holding a red balloon.")
    expect(out).toContain("a child around 7 years old")
    expect(out).toContain("a soft smile")
    expect(out).toContain("holding a red balloon")
    expect(out).not.toMatch(/with and|narrow hips/i)
    expect(out.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })
})

describe("minor-age-floor policy", () => {
  it("is the identity when subjectMinor is not true (adults, every non-entity lane)", () => {
    registerMainlinePromptPolicies()
    const adult = { prompt: P0, negativePrompt: "", kind: "image" as const }
    expect(applyPromptPolicies(adult)).toEqual(adult)
    expect(applyPromptPolicies({ ...adult, subjectMinor: false })).toEqual({ ...adult, subjectMinor: false })
  })

  it("floors an image assembly with subjectMinor: true", () => {
    registerMainlinePromptPolicies()
    const out = applyPromptPolicies({ prompt: P0, negativePrompt: "", kind: "image", subjectMinor: true })
    expect(out.prompt).toContain(MODEST_ATTIRE_CLAUSE)
    expect(out.prompt).not.toMatch(/hugging the contours/i)
  })

  it("registers once even if called twice", () => {
    registerMainlinePromptPolicies()
    registerMainlinePromptPolicies()
    const out = applyPromptPolicies({ prompt: "a child, red coat.", negativePrompt: "", kind: "image", subjectMinor: true })
    expect(out.prompt.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
  })
})
