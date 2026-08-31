/**
 * The subject registry is the platform-owned contract for the flat `subject`
 * wire channel: WHICH keys ride it, in WHAT order the rows fold, and HOW each
 * catalog renders its selection. Every assertion here is a pin on that
 * contract — a failure means a reorder / retable was intentional and the
 * changeset has to say so.
 *
 * Two pins are load-bearing beyond mere table hygiene:
 *  - the FLAT-BAG dedupe (`lipState` suppressing `makeup-bold-lips`), which is
 *    the reason the wire is flat and which fails on any future nesting;
 *  - the GRAMMAR pin (person/styling arrive as ONE comma-joined clause, never N
 *    `". "`-joined fragments), which is why those rows are `kind: "group"`.
 */
import { describe, it, expect } from "vitest"
import {
  MAX_SUBJECT_KEYS,
  SUBJECT_ARRAY_CEILING,
  SUBJECT_CUSTOM_AGE_KEY,
  SUBJECT_FIELDS,
  SUBJECT_FOLD_KEYS,
  SUBJECT_ID_MAX_CHARS,
  SUBJECT_IMAGE_HINT_MODE_DEFAULT,
  SUBJECT_KEYS,
  SUBJECT_VIDEO_HINT_MODE_DEFAULT,
  normalizeSubjectFields,
  renderSubjectHints,
  subjectFieldsForSurface,
} from "../subject-registry.js"
import {
  DIRECTION_ARRAY_CEILING,
  DIRECTION_ID_MAX_CHARS,
  DIRECTION_KEYS,
} from "../direction-registry.js"
import {
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  buildPersonHints,
  getPersonPromptHint,
  getPersonTerm,
} from "../person.js"
import {
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  getStylingPromptHint,
} from "../styling.js"
import { getHeldPropPromptHint } from "../held-prop.js"
import { getAnimalPromptHint, getAnimalTerm } from "@nodaro/shared"

const IMAGE = { surface: "image" } as const
const VIDEO = { surface: "video" } as const

// Real catalog ids — every getter returns "" on a miss, so a fake id would make
// most of these assertions vacuously pass.
const NO_SUCH_ID = "__no_such_id__"

describe("SUBJECT_FIELDS — table integrity", () => {
  it("has unique row keys", () => {
    const keys = SUBJECT_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("gives every row a render function, and every ids row a positive maxPicks", () => {
    for (const spec of SUBJECT_FIELDS) {
      expect(typeof spec.render, spec.key).toBe("function")
      if (spec.kind === "ids") expect(spec.maxPicks, spec.key).toBeGreaterThanOrEqual(1)
    }
  })

  it("exports SUBJECT_FOLD_KEYS in table order", () => {
    expect(SUBJECT_FOLD_KEYS).toEqual(SUBJECT_FIELDS.map((f) => f.key))
  })

  it("pins the fold order (a reorder is a deliberate, changeset-worthy change)", () => {
    expect(SUBJECT_FOLD_KEYS).toEqual(["person", "styling", "heldProp", "material", "animal"])
  })

  it("folds both group rows before any prop row", () => {
    const lastGroup = SUBJECT_FIELDS.map((f) => f.kind).lastIndexOf("group")
    const firstIds = SUBJECT_FIELDS.map((f) => f.kind).indexOf("ids")
    expect(lastGroup).toBeLessThan(firstIds)
  })

  it("folds every row on both surfaces today", () => {
    expect(subjectFieldsForSurface("image").map((f) => f.key)).toEqual([...SUBJECT_FOLD_KEYS])
    expect(subjectFieldsForSurface("video").map((f) => f.key)).toEqual([...SUBJECT_FOLD_KEYS])
  })

  it("takes its bounds FROM the direction registry (one literal, both channels)", () => {
    expect(SUBJECT_ID_MAX_CHARS).toBe(DIRECTION_ID_MAX_CHARS)
    expect(SUBJECT_ARRAY_CEILING).toBe(DIRECTION_ARRAY_CEILING)
  })

  it("defaults image to full clauses and video to compact terms", () => {
    expect(SUBJECT_IMAGE_HINT_MODE_DEFAULT).toBe("full")
    expect(SUBJECT_VIDEO_HINT_MODE_DEFAULT).toBe("compact")
  })
})

describe("SUBJECT_KEYS — the derived wire vocabulary", () => {
  it("is unique and fits the record bound", () => {
    expect(new Set(SUBJECT_KEYS).size).toBe(SUBJECT_KEYS.length)
    expect(SUBJECT_KEYS.length).toBeLessThanOrEqual(MAX_SUBJECT_KEYS)
  })

  it("carries every person field, every styling field, customAge and the three props", () => {
    for (const d of PERSON_DIMENSION_ORDER) {
      expect(SUBJECT_KEYS, d).toContain(PERSON_FIELD_BY_DIMENSION[d])
    }
    for (const d of STYLING_DIMENSION_ORDER) {
      expect(SUBJECT_KEYS, d).toContain(STYLING_FIELD_BY_DIMENSION[d])
    }
    expect(SUBJECT_KEYS).toContain(SUBJECT_CUSTOM_AGE_KEY)
    expect(SUBJECT_KEYS).toContain("heldProp")
    expect(SUBJECT_KEYS).toContain("material")
    expect(SUBJECT_KEYS).toContain("animal")
    expect(SUBJECT_KEYS.length).toBe(
      PERSON_DIMENSION_ORDER.length + STYLING_DIMENSION_ORDER.length + 1 + 3,
    )
  })

  it("excludes the free-text pre/post fields (the v1 carve-out)", () => {
    expect(SUBJECT_KEYS).not.toContain("preText")
    expect(SUBJECT_KEYS).not.toContain("postText")
  })

  it("is DISJOINT from DIRECTION_KEYS — nothing folds twice", () => {
    const direction = new Set<string>(DIRECTION_KEYS)
    expect(SUBJECT_KEYS.filter((k) => direction.has(k))).toEqual([])
  })
})

describe("renderSubjectHints — inertness", () => {
  it("returns [] for undefined, {} and a non-object", () => {
    expect(renderSubjectHints(undefined, IMAGE)).toEqual([])
    expect(renderSubjectHints({}, IMAGE)).toEqual([])
    expect(renderSubjectHints([] as never, IMAGE)).toEqual([])
  })

  it("ignores unknown wire keys", () => {
    expect(renderSubjectHints({ notAField: "man", hairColor: NO_SUCH_ID }, IMAGE)).toEqual([])
  })

  it("skips unknown ids instead of 400ing on them", () => {
    expect(renderSubjectHints({ type: NO_SUCH_ID, animal: NO_SUCH_ID }, IMAGE)).toEqual([])
  })

  it("drops preText / postText — the carve-out that stops a double emission", () => {
    expect(
      renderSubjectHints(
        { preText: "a lone wanderer", postText: "seen from behind" } as never,
        IMAGE,
      ),
    ).toEqual([])
    const withPerson = renderSubjectHints(
      { type: "woman", preText: "a lone wanderer" } as never,
      IMAGE,
    )
    expect(withPerson).toEqual([getPersonPromptHint("woman")])
  })
})

describe("renderSubjectHints — grammar (the R4 pin)", () => {
  it("emits person as ONE comma-joined clause, not N fragments", () => {
    const bag = { type: "woman", ethnicity: "east-asian", hairBase: "base-short-straight" }
    const out = renderSubjectHints(bag, IMAGE)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(buildPersonHints(bag, "full").join(", "))
    expect(out[0]).toContain(", ")
  })

  it("emits styling as its own single clause, after person", () => {
    const out = renderSubjectHints({ type: "woman", makeup: "makeup-smoky" }, IMAGE)
    expect(out).toEqual([getPersonPromptHint("woman"), getStylingPromptHint("makeup-smoky")])
  })

  it("folds the prop rows after both group rows, in table order", () => {
    const out = renderSubjectHints(
      { type: "man", heldProp: "smartphone", material: "silk", animal: "dog-corgi" },
      IMAGE,
    )
    expect(out[0]).toBe(getPersonPromptHint("man"))
    expect(out).toContain(getHeldPropPromptHint("smartphone"))
    expect(out[out.length - 1]).toBe(getAnimalPromptHint("dog-corgi"))
  })

  it("renders compact terms in compact mode", () => {
    const bag = { type: "not-defined", animal: "dog-corgi" }
    expect(renderSubjectHints(bag, { ...VIDEO, mode: "compact" })).toEqual([
      getPersonTerm("not-defined"),
      getAnimalTerm("dog-corgi"),
    ])
  })
})

describe("renderSubjectHints — the flat-bag behaviors", () => {
  it("dedupes the lipstick clause across the person and styling catalogs (R3)", () => {
    const out = renderSubjectHints(
      { lipState: "lip-state-bold-red", makeup: "makeup-bold-lips" },
      IMAGE,
    )
    expect(out).toEqual([getPersonPromptHint("lip-state-bold-red")])
    expect(out.join(" ")).not.toContain(getStylingPromptHint("makeup-bold-lips"))
  })

  it("keeps a NON-twin makeup pick alongside the bold-red lip state", () => {
    const out = renderSubjectHints(
      { lipState: "lip-state-bold-red", makeup: "makeup-smoky" },
      IMAGE,
    )
    expect(out).toEqual([
      getPersonPromptHint("lip-state-bold-red"),
      getStylingPromptHint("makeup-smoky"),
    ])
  })

  it("folds midriff + navel into the single neutral safety clause", () => {
    const out = renderSubjectHints(
      { distinctiveFeature: ["feature-midriff-visible", "feature-navel-visible"] },
      IMAGE,
    )
    expect(out).toEqual(["wearing a cropped style, midriff and navel visible"])
  })

  it("de-duplicates an exact repeated clause, first occurrence winning", () => {
    const out = renderSubjectHints({ heldProp: ["smartphone", "smartphone"] }, IMAGE)
    expect(out).toEqual([getHeldPropPromptHint("smartphone")])
  })
})

describe("normalizeSubjectFields — the cap the builders do not apply", () => {
  it("slices a multi-pick dimension to its registry limit (jewelry = 3)", () => {
    const ids = ["jewelry-subtle", "jewelry-statement", "jewelry-gold", "jewelry-silver", "jewelry-layered"]
    expect(normalizeSubjectFields({ jewelry: ids })).toEqual({ jewelry: ids.slice(0, 3) })
    const out = renderSubjectHints({ jewelry: ids }, IMAGE)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(ids.slice(0, 3).map(getStylingPromptHint).join(", "))
    expect(out[0]).not.toContain(getStylingPromptHint("jewelry-silver"))
  })

  it("slices a 2-pick dimension handed the full array ceiling", () => {
    const eight = Array.from({ length: SUBJECT_ARRAY_CEILING }, (_, i) => `texture-${i}`)
    const normalized = normalizeSubjectFields({ skinTexture: eight }) as Record<string, unknown>
    expect(normalized.skinTexture).toEqual(eight.slice(0, 2))
  })

  it("slices the prop rows to their row maxPicks", () => {
    const props = ["smartphone", "smartphone-raised", "polaroid-camera"]
    const normalized = normalizeSubjectFields({ heldProp: props }) as Record<string, unknown>
    expect(normalized.heldProp).toEqual(props.slice(0, 2))
  })

  it("collapses a single-pick dimension's array to a bare string — without this it folds to NOTHING", () => {
    expect(normalizeSubjectFields({ hairBase: ["base-buzz"] })).toEqual({ hairBase: "base-buzz" })
    expect(renderSubjectHints({ hairBase: ["base-buzz"] }, IMAGE)).toEqual([
      getPersonPromptHint("base-buzz"),
    ])
  })

  it("drops unknown keys, so the persisted input_data stays platform vocabulary", () => {
    expect(normalizeSubjectFields({ type: "man", notAField: "x", preText: "y" })).toEqual({
      type: "man",
    })
  })

  it("drops empty strings and non-string entries", () => {
    expect(normalizeSubjectFields({ type: "", jewelry: ["", 7 as never, "jewelry-gold"] })).toEqual({
      jewelry: "jewelry-gold",
    })
  })

  it("returns undefined for an empty or all-unknown bag (never {})", () => {
    expect(normalizeSubjectFields(undefined)).toBeUndefined()
    expect(normalizeSubjectFields({})).toBeUndefined()
    expect(normalizeSubjectFields({ notAField: "x" })).toBeUndefined()
  })

  it("never mutates the caller's object", () => {
    const bag = { jewelry: ["jewelry-subtle", "jewelry-statement", "jewelry-gold", "jewelry-silver"] }
    const before = JSON.stringify(bag)
    normalizeSubjectFields(bag)
    expect(JSON.stringify(bag)).toBe(before)
  })

  it("is idempotent (a door may normalize before the renderer does)", () => {
    const bag = { type: "man", jewelry: ["jewelry-gold", "jewelry-silver"], customAge: 34.6 }
    const once = normalizeSubjectFields(bag)
    expect(normalizeSubjectFields(once)).toEqual(once)
  })
})

describe("customAge — the one number on the wire", () => {
  it("renders the literal age when age === 'age-custom'", () => {
    expect(renderSubjectHints({ age: "age-custom", customAge: 34 }, IMAGE)).toEqual([
      "34 years old",
    ])
  })

  it("emits nothing for age-custom with no customAge", () => {
    expect(renderSubjectHints({ age: "age-custom" }, IMAGE)).toEqual([])
  })

  it("clamps and rounds to a whole 0..120", () => {
    expect(normalizeSubjectFields({ customAge: 34.6 })).toEqual({ customAge: 35 })
    expect(normalizeSubjectFields({ customAge: -5 })).toEqual({ customAge: 0 })
    expect(normalizeSubjectFields({ customAge: 9999 })).toEqual({ customAge: 120 })
  })

  it("drops a non-finite or non-number customAge", () => {
    expect(normalizeSubjectFields({ customAge: Number.NaN })).toBeUndefined()
    expect(normalizeSubjectFields({ customAge: "34" })).toBeUndefined()
  })
})
