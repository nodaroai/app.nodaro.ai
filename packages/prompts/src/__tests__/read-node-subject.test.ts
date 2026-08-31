/**
 * `readSubjectFields` is the CANVAS door into the subject fold — the twin of
 * the route's `subjectSchema`. It reads untrusted persisted node JSONB (a
 * workflow write is validated only as `z.record(z.string(), z.unknown())`), so
 * every assertion here is on the three contracts it shares with
 * `readDirectionFields`: drop-never-throw, `undefined` never `{}`, and bounds
 * that MATCH the wire door by shared constant.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readSubjectFields } from "../read-node-direction.js"
import {
  SUBJECT_ARRAY_CEILING,
  SUBJECT_ID_MAX_CHARS,
  SUBJECT_KEYS,
  getRegisteredSubjectKeys,
  renderSubjectHints,
} from "../subject-registry.js"
import { registerPersonPack, resetPersonPacks } from "../person-packs.js"
import { resetCatalogPacks } from "../catalog-packs.js"
import { getPersonPromptHint } from "../person.js"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

const pack = {
  id: "test/person-sector",
  dimensions: [{ dimension: "sector-attire", field: "sectorAttire", label: "Sector Attire" }],
  entries: [
    {
      id: "attire-modest-suit",
      label: "Modest Suit",
      group: "Attire",
      dimension: "sector-attire",
      description: "a modest tailored suit",
      promptHint: "wearing a modest tailored suit",
    },
  ],
}

describe("readSubjectFields — shape", () => {
  it("round-trips the ids a node actually stores", () => {
    expect(
      readSubjectFields({
        type: "woman",
        hairBase: "base-buzz",
        jewelry: ["jewelry-gold", "jewelry-silver"],
        animal: "dog-corgi",
      }),
    ).toEqual({
      type: "woman",
      hairBase: "base-buzz",
      jewelry: ["jewelry-gold", "jewelry-silver"],
      animal: "dog-corgi",
    })
  })

  it("returns undefined — never {} — for a blob with nothing readable", () => {
    expect(readSubjectFields(undefined)).toBeUndefined()
    expect(readSubjectFields(null)).toBeUndefined()
    expect(readSubjectFields("nope")).toBeUndefined()
    expect(readSubjectFields([])).toBeUndefined()
    expect(readSubjectFields({})).toBeUndefined()
    expect(readSubjectFields({ notAField: "man" })).toBeUndefined()
  })

  it("drops junk instead of throwing on it", () => {
    expect(
      readSubjectFields({
        type: { nested: true },
        hairBase: 42,
        jewelry: [null, { x: 1 }, "jewelry-gold"],
        makeup: "",
      }),
    ).toEqual({ jewelry: ["jewelry-gold"] })
  })

  it("filters junk BEFORE the ceiling, so valid ids behind it survive", () => {
    const v = [...Array.from({ length: SUBJECT_ARRAY_CEILING }, () => 1), "jewelry-gold"]
    expect(readSubjectFields({ jewelry: v })).toEqual({ jewelry: ["jewelry-gold"] })
  })
})

describe("readSubjectFields — bounds shared with the wire door", () => {
  it("keeps the first SUBJECT_ARRAY_CEILING entries of an over-long array", () => {
    const many = Array.from({ length: SUBJECT_ARRAY_CEILING + 5 }, (_, i) => `id-${i}`)
    const out = readSubjectFields({ jewelry: many }) as Record<string, unknown>
    expect(out.jewelry).toEqual(many.slice(0, SUBJECT_ARRAY_CEILING))
  })

  it("drops an id longer than SUBJECT_ID_MAX_CHARS, keeping one exactly at the bound", () => {
    const ok = "x".repeat(SUBJECT_ID_MAX_CHARS)
    const tooLong = "x".repeat(SUBJECT_ID_MAX_CHARS + 1)
    expect(readSubjectFields({ type: tooLong })).toBeUndefined()
    expect(readSubjectFields({ type: ok })).toEqual({ type: ok })
    expect(readSubjectFields({ jewelry: [tooLong, ok] })).toEqual({ jewelry: [ok] })
  })

  it("does NOT apply the per-dimension cap — that stays the renderer's slice", () => {
    const four = ["jewelry-subtle", "jewelry-statement", "jewelry-gold", "jewelry-silver"]
    expect((readSubjectFields({ jewelry: four }) as Record<string, unknown>).jewelry).toEqual(four)
  })
})

describe("readSubjectFields — customAge, the one number", () => {
  it("passes a finite number through for the renderer to clamp", () => {
    expect(readSubjectFields({ age: "age-custom", customAge: 34 })).toEqual({
      age: "age-custom",
      customAge: 34,
    })
    expect(readSubjectFields({ customAge: 9999 })).toEqual({ customAge: 9999 })
    expect(renderSubjectHints(readSubjectFields({ age: "age-custom", customAge: 9999 }), {
      surface: "image",
    })).toEqual(["120 years old"])
  })

  it("drops a non-finite or non-number customAge", () => {
    expect(readSubjectFields({ customAge: Number.NaN })).toBeUndefined()
    expect(readSubjectFields({ customAge: "34" })).toBeUndefined()
  })
})

describe("readSubjectFields — pack awareness", () => {
  it("with no packs registered, the accepted key set IS SUBJECT_KEYS", () => {
    expect(getRegisteredSubjectKeys()).toEqual([...SUBJECT_KEYS])
  })

  it("reads a deployment-registered pack dimension, and folds its hint", () => {
    expect(readSubjectFields({ sectorAttire: "attire-modest-suit" })).toBeUndefined()
    registerPersonPack(pack)
    expect(getRegisteredSubjectKeys()).toContain("sectorAttire")
    expect(readSubjectFields({ sectorAttire: "attire-modest-suit" })).toEqual({
      sectorAttire: "attire-modest-suit",
    })
    expect(
      renderSubjectHints({ type: "woman", sectorAttire: "attire-modest-suit" }, { surface: "image" }),
    ).toEqual([`${getPersonPromptHint("woman")}, wearing a modest tailored suit`])
  })
})
