import { describe, it, expect, afterEach } from "vitest"
import { isMinorAge, ADULT_AGE_IDS, MINOR_IMPLYING_TYPE_IDS, getAdultOnlyIds, getMinorAgeHintStrings, containsMinorAgeHint, buildNeedleAlternationSource } from "../age-floor.js"
import { getRegisteredPeople, resetPersonPacks } from "../person-packs.js"
import { PEOPLE } from "../person.js"
import { MOODS } from "../mood.js"
import { POSES } from "../pose.js"
import { PHOTO_GENRES } from "../photo-genre.js"
import { STYLINGS } from "../styling.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

describe("isMinorAge — an ADULT allow-list, never a minor deny-list", () => {
  it("every catalog age id outside ADULT_AGE_IDS is inside the floor (a new age id defaults IN)", () => {
    const ageIds = PEOPLE.filter((p) => p.dimension === "age" && p.id !== "age-custom").map((p) => p.id)
    for (const id of ageIds) {
      expect(isMinorAge({ age: id }), id).toBe(!ADULT_AGE_IDS.has(id))
    }
    // The teen buckets are all inside, including the 16-19 one (decision 2).
    for (const id of ["age-baby", "age-toddler", "age-young-child", "age-child", "age-pre-teen", "age-early-teen", "age-late-teen", "age-teen"]) {
      expect(isMinorAge({ age: id }), id).toBe(true)
    }
    for (const id of ADULT_AGE_IDS) expect(isMinorAge({ age: id }), id).toBe(false)
  })

  it("custom age: the boundary matches buildAgeFragment's 'in their teens' cut (< 20)", () => {
    expect(isMinorAge({ age: "age-custom", customAge: 5 })).toBe(true)
    expect(isMinorAge({ age: "age-custom", customAge: 19 })).toBe(true)
    expect(isMinorAge({ age: "age-custom", customAge: 20 })).toBe(false)
    expect(isMinorAge({ age: "age-custom", customAge: 47 })).toBe(false)
    // age-custom with no number is unknown → floor.
    expect(isMinorAge({ age: "age-custom" })).toBe(true)
  })

  it("no age at all: only a minor-implying TYPE puts the subject in the floor", () => {
    expect(isMinorAge({})).toBe(false)
    expect(isMinorAge(undefined)).toBe(false)
    expect(isMinorAge({ type: "beautiful-woman" })).toBe(false)
    for (const t of MINOR_IMPLYING_TYPE_IDS) expect(isMinorAge({ type: t }), t).toBe(true)
  })

  it("an adult age wins over a minor-implying type", () => {
    expect(isMinorAge({ type: "peter-pan", age: "age-30s" })).toBe(false)
  })

  it("MINOR_IMPLYING_TYPE_IDS name real type entries", () => {
    const typeIds = new Set(PEOPLE.filter((p) => p.dimension === "type").map((p) => p.id))
    for (const t of MINOR_IMPLYING_TYPE_IDS) expect(typeIds.has(t), t).toBe(true)
  })
})

describe("getAdultOnlyEntries reads catalogs through the pack-composed funnel", () => {
  afterEach(() => resetCatalogPacks())

  it("a pack-added mood option with adultOnly:true reaches the floor", () => {
    registerCatalogPack({
      id: "test/mood-adult",
      catalogId: "mood",
      mode: "extend",
      options: [
        {
          id: "test-sultry-2",
          label: "Sultry 2",
          promptHint: "with a sultry expression",
          term: "sultry",
          category: MOODS[0].category,
          adultOnly: true,
        },
      ],
    })
    expect(getAdultOnlyIds().has("test-sultry-2")).toBe(true)
  })
})

describe("getAdultOnlyEntries propagates BASE-catalog flags too (not only pack-added ones)", () => {
  // Guards the flattening path (`toOptions` / dimension builders in
  // picker-catalogs.ts), which is separate from the pack-composition path the
  // test above exercises: a base mood/pose/photo-genre/styling entry authored
  // with `adultOnly: true` must survive being flattened into a `PickerOption`
  // by `getRegisteredPickerCatalogs()`, or the floor silently loses it the
  // moment content (not just packs) sets the flag. Currently vacuous (no base
  // entry is flagged yet — Task 3 hand-curates them) but fails immediately if
  // the flattening ever stops copying `adultOnly`.
  it("every adultOnly:true id in the raw styling/mood/pose/photo-genre catalogs reaches getAdultOnlyIds()", () => {
    const flaggedIds = [...STYLINGS, ...MOODS, ...POSES, ...PHOTO_GENRES]
      .filter((e) => e.adultOnly === true)
      .map((e) => e.id)
    const ids = getAdultOnlyIds()
    for (const id of flaggedIds) expect(ids.has(id), id).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// W1-a fix round 1: the TEXT signal.
//
// `isMinorAge` reads the structured picker value — which the P0 arrival path
// does not have. person.nodaro.ai creates the character row with
// `{nodeId, name, projectId}` and never persists the `person` selection, so
// `row.person === null` and the only age evidence is the client-assembled
// prompt text itself. The client assembles that text FROM these very hints,
// so the catalog is the drift-proof needle list.
// ---------------------------------------------------------------------------
describe("getMinorAgeHintStrings — catalog-derived minor-age needles", () => {
  afterEach(() => {
    resetPersonPacks()
    resetCatalogPacks()
  })

  const minorAgeIds = () =>
    getRegisteredPeople()
      .filter((p) => p.dimension === "age" && !ADULT_AGE_IDS.has(p.id) && p.promptHint.length >= 8)
      .map((p) => p.id)

  it("carries every minor age id's hint and no adult age id's hint", () => {
    const hints = new Set(getMinorAgeHintStrings())
    const byId = new Map(getRegisteredPeople().map((p) => [p.id, p]))
    for (const id of minorAgeIds()) {
      expect(hints.has(byId.get(id)!.promptHint.toLowerCase()), id).toBe(true)
    }
    for (const id of ADULT_AGE_IDS) {
      const hint = byId.get(id)?.promptHint
      if (hint) expect(hints.has(hint.toLowerCase()), id).toBe(false)
    }
  })

  it("carries every minor-implying TYPE's hint", () => {
    const hints = new Set(getMinorAgeHintStrings())
    const byId = new Map(getRegisteredPeople().map((p) => [p.id, p]))
    for (const t of MINOR_IMPLYING_TYPE_IDS) {
      expect(hints.has(byId.get(t)!.promptHint.toLowerCase()), t).toBe(true)
    }
  })

  it("never yields an empty or bare-word needle (age-custom's hint is \"\")", () => {
    for (const h of getMinorAgeHintStrings()) {
      expect(h.length).toBeGreaterThanOrEqual(8)
      expect(h.trim()).toBe(h)
    }
    expect(getMinorAgeHintStrings()).not.toContain("")
    expect(getMinorAgeHintStrings()).not.toContain("child")
    expect(getMinorAgeHintStrings()).not.toContain("teen")
  })

  it("is longest-first (a shorter needle can be a substring of a longer one)", () => {
    const lens = getMinorAgeHintStrings().map((s) => s.length)
    expect([...lens].sort((a, b) => b - a)).toEqual(lens)
  })

  it("reads through the pack-composed funnel — a pack-added age entry is swept", () => {
    // A deployment pack's new age id is NOT in ADULT_AGE_IDS, so it is inside
    // the floor by default and its hint becomes a needle with no second list
    // to update. This is the property a raw-PEOPLE reader would lose.
    registerCatalogPack({
      id: "test/person-minor-age",
      catalogId: "person",
      mode: "extend",
      dimensions: [
        {
          dimension: "age",
          field: "age",
          label: "Age",
          options: [
            {
              id: "age-space-cadet",
              label: "Space cadet",
              promptHint: "a cadet fresh out of the academy, barely sixteen",
            },
          ],
        },
      ],
    } as never)
    expect(getMinorAgeHintStrings()).toContain("a cadet fresh out of the academy, barely sixteen")
    expect(containsMinorAgeHint("a cadet fresh out of the academy, barely sixteen, standing tall")).toBe(true)
  })
})

describe("containsMinorAgeHint — the minor-age signal in free text", () => {
  it("hits every minor age id's own hint; misses every adult one", () => {
    const byId = new Map(getRegisteredPeople().map((p) => [p.id, p]))
    for (const p of getRegisteredPeople()) {
      if (p.dimension !== "age" || p.promptHint.length < 8) continue
      const expected = !ADULT_AGE_IDS.has(p.id)
      expect(containsMinorAgeHint(`a portrait of someone ${p.promptHint}, smiling`), p.id).toBe(expected)
    }
    // The two adult hints that CARRY a number are the closest thing to the
    // boundary — "around 21 years old" / "around 27 years old" must not fire.
    expect(containsMinorAgeHint(byId.get("age-early-20s")!.promptHint)).toBe(false)
    expect(containsMinorAgeHint(byId.get("age-late-20s")!.promptHint)).toBe(false)
    expect(containsMinorAgeHint("elderly, in their 70s or older")).toBe(false)
  })

  it("hits every minor-implying type's hint", () => {
    const byId = new Map(getRegisteredPeople().map((p) => [p.id, p]))
    for (const t of MINOR_IMPLYING_TYPE_IDS) {
      expect(containsMinorAgeHint(byId.get(t)!.promptHint), t).toBe(true)
    }
  })

  it("numeric ages: under 20 hits, 20+ does not", () => {
    expect(containsMinorAgeHint("a 16 year old")).toBe(true)
    expect(containsMinorAgeHint("a 16 years old girl")).toBe(true)
    expect(containsMinorAgeHint("a 5-year-old on a swing")).toBe(true)
    expect(containsMinorAgeHint("around 1 year old")).toBe(true)
    expect(containsMinorAgeHint("a toddler around 2-3 years old")).toBe(true)
    expect(containsMinorAgeHint("19 years old, in their teens")).toBe(true)
    expect(containsMinorAgeHint("a 25 year old")).toBe(false)
    expect(containsMinorAgeHint("a 20 year old")).toBe(false)
    expect(containsMinorAgeHint("34 years old")).toBe(false)
    // "old"/"older" must not glue: the trailing boundary is what stops it.
    expect(containsMinorAgeHint("a 5 year older sibling")).toBe(false)
  })

  it("the custom-age teens shape hits", () => {
    expect(containsMinorAgeHint("in their teens")).toBe(true)
    expect(containsMinorAgeHint("17 years old, in their teens")).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Final review, item 2: the detector only knew the shapes `buildAgeFragment`
  // itself emits. Everything a HUMAN or an LLM writes instead — "aged 12",
  // "12yo", "12 y.o.", "12 yr old" — read as no age at all, which meant the
  // WHOLE floor was absent for those prompts (no subjectMinor, no strip, no
  // modest clause). Table-driven so a new shape is one row, and every shape is
  // pinned on BOTH sides of the < 20 cut: a rule that fires on a minor must
  // stay silent on the adult spelled the same way.
  // ───────────────────────────────────────────────────────────────────────
  describe("colloquial age shapes (table-driven, minor and adult)", () => {
    const SHAPES: ReadonlyArray<{ label: string; minor: string; adult: string }> = [
      { label: "N years old",     minor: "a 12 years old at the fair",  adult: "a 25 years old at the fair" },
      { label: "N year old",      minor: "a 12 year old at the fair",   adult: "a 25 year old at the fair" },
      { label: "N-year-old",      minor: "a 12-year-old at the fair",   adult: "a 25-year-old at the fair" },
      { label: "aged N",          minor: "a portrait, aged 12",         adult: "a portrait, aged 45" },
      { label: "age N",           minor: "a portrait, age 12",          adult: "a portrait, age 45" },
      { label: "at the age of N", minor: "a portrait at the age of 12", adult: "a portrait at the age of 45" },
      { label: "Nyo",             minor: "a 12yo at the fair",          adult: "a 25yo at the fair" },
      { label: "N yo",            minor: "a 12 yo at the fair",         adult: "a 25 yo at the fair" },
      { label: "N y.o.",          minor: "a 12 y.o. at the fair",       adult: "a 25 y.o. at the fair" },
      { label: "N y/o",           minor: "a 12 y/o at the fair",        adult: "a 25 y/o at the fair" },
      { label: "N yr old",        minor: "a 12 yr old at the fair",     adult: "a 25 yr old at the fair" },
      { label: "N-yr-old",        minor: "a 12-yr-old at the fair",     adult: "a 25-yr-old at the fair" },
      { label: "Nyrs old",        minor: "a 12yrs old at the fair",     adult: "a 25yrs old at the fair" },
      { label: "N years of age",  minor: "a 12 years of age subject",   adult: "a 25 years of age subject" },
    ]
    for (const { label, minor, adult } of SHAPES) {
      it(`"${label}" — the minor spelling hits`, () => expect(containsMinorAgeHint(minor), minor).toBe(true))
      it(`"${label}" — the adult spelling does not`, () => expect(containsMinorAgeHint(adult), adult).toBe(false))
    }

    // The negatives that are NOT simply "the same shape with a bigger number":
    // near-miss text that must never be read as an age at all.
    it("non-age lookalikes stay silent", () => {
      expect(containsMinorAgeHint("a 5 year older sibling")).toBe(false)
      expect(containsMinorAgeHint("a woman in their 30s")).toBe(false)
      expect(containsMinorAgeHint("elderly, in their 70s or older")).toBe(false)
      // "age" glued to a preceding word character is not the word "age".
      expect(containsMinorAgeHint("image 12 of the set")).toBe(false)
      expect(containsMinorAgeHint("page 3 of the brief")).toBe(false)
      // "yo" may not glue onto the next word.
      expect(containsMinorAgeHint("12 young oak trees")).toBe(false)
      expect(containsMinorAgeHint("a 12 yoga session")).toBe(false)
      // The trailing boundary keeps ordinals out.
      expect(containsMinorAgeHint("aged 12th in the rankings")).toBe(false)
    })
  })

  // Final review, item 4: the needle alternation was literal, so a hint the
  // writer re-spaced or hyphenated slipped past it.
  it("a minor hint is matched however it was spaced or hyphenated", () => {
    expect(containsMinorAgeHint("in  their  teens")).toBe(true)
    expect(containsMinorAgeHint("in-their-teens")).toBe(true)
    const hint = getMinorAgeHintStrings().find((h) => h.includes(" ")) as string
    expect(containsMinorAgeHint(hint.replace(/ /g, "   "))).toBe(true)
    expect(containsMinorAgeHint(hint.replace(/ /g, "-"))).toBe(true)
  })

  it("does NOT fire on a bare mention of a child by an adult subject", () => {
    expect(containsMinorAgeHint("a mother holding her child")).toBe(false)
    expect(containsMinorAgeHint("a woman in her 30s reading to a child")).toBe(false)
    expect(containsMinorAgeHint("a teacher, in their 40s, in a classroom of children")).toBe(false)
    expect(containsMinorAgeHint("a childhood home in winter")).toBe(false)
  })

  it("empty / absent text is never a hit", () => {
    expect(containsMinorAgeHint("")).toBe(false)
    expect(containsMinorAgeHint("   ")).toBe(false)
    expect(containsMinorAgeHint(null)).toBe(false)
    expect(containsMinorAgeHint(undefined)).toBe(false)
  })

  it("THE INCIDENT STRING (2026-07-30, app_reports P0): client-assembled seedPrompt, no picker value", () => {
    const incident =
      "a young child around 5 years old, the clothing fitted and form-conscious, hugging the contours of the body, with lips slightly parted, taking a soft breath"
    // Two independent rules catch it: the verbatim `age-young-child` hint, and
    // the numeric shape "5 years old".
    expect(containsMinorAgeHint(incident)).toBe(true)
    // The same prompt about an adult subject must stay untouched.
    const adultMirror = incident.replace("a young child around 5 years old", "a woman in her 30s")
    expect(containsMinorAgeHint(adultMirror)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The shared needle builder — the single matcher definition BOTH layers use
// (Layer 1's `minorNeedleRegex`, Layer 2's backend strip alternation). Tested
// here directly so its two properties are pinned independently of whichever
// catalog phrases happen to be flagged today.
// ───────────────────────────────────────────────────────────────────────────
describe("buildNeedleAlternationSource", () => {
  function match(needles: ReadonlyArray<string>, text: string): boolean {
    const src = buildNeedleAlternationSource(needles)
    return src !== null && new RegExp(src, "i").test(text)
  }

  it("tolerates any whitespace/hyphen spelling of the needle's separators", () => {
    const needles = ["very full bust", "full bust"]
    expect(match(needles, "very full bust")).toBe(true)
    expect(match(needles, "very-full bust")).toBe(true)
    expect(match(needles, "very   full    bust")).toBe(true)
    expect(match(needles, "very\nfull\tbust")).toBe(true)
  })

  it("still requires AT LEAST one separator — it is not a substring rule", () => {
    expect(match(["very full bust", "full bust"], "very fullbust")).toBe(false)
    expect(match(["full bust"], "afullbust")).toBe(false)
  })

  it("keeps the word boundaries: a needle may not glue onto an adjacent word", () => {
    expect(match(["mesh top"], "mesh tops")).toBe(false)
    expect(match(["mesh top"], "a mesh top, and boots")).toBe(true)
    expect(match(["narrow hips"], "narrow hipster jeans")).toBe(false)
  })

  it("escapes regex metacharacters in a needle", () => {
    expect(match(["a (soft) breath."], "taking a (soft) breath. done")).toBe(true)
    expect(match(["a.b"], "axb")).toBe(false)
  })

  it("returns null for an empty list rather than an everything-matches regex", () => {
    expect(buildNeedleAlternationSource([])).toBeNull()
    expect(buildNeedleAlternationSource(["", "   "])).toBeNull()
  })

  it("preserves the caller's ordering (longest-first stays longest-first)", () => {
    const src = buildNeedleAlternationSource(["very full bust", "full bust"]) as string
    expect(src.indexOf("very")).toBeLessThan(src.lastIndexOf("full"))
    const m = "a very full bust portrait".match(new RegExp(src, "i"))
    expect(m?.[0]).toBe("very full bust")
  })
})
