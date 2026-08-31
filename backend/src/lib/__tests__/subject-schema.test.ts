import { describe, it, expect, beforeEach } from "vitest"
import {
  MAX_SUBJECT_KEYS,
  SUBJECT_ARRAY_CEILING,
  SUBJECT_ID_MAX_CHARS,
  SUBJECT_KEY_MAX_CHARS,
  getStylingPromptHint,
  getPersonPromptHint,
  registerPersonPack,
  renderSubjectHints,
  resetCatalogPacks,
  resetPersonPacks,
} from "@nodaro/prompts"
import { subjectSchema } from "../subject-schema.js"

/**
 * The WIRE door into the subject fold. Two things are pinned here that nothing
 * else can pin:
 *
 *  1. THE PACK REGRESSION (why this is a `z.record` and not the derived
 *     `z.object` direction uses): a deployment-registered person dimension must
 *     SURVIVE the schema. A fixed key set plus the deliberate non-strict posture
 *     would have dropped it silently — no error, no clause, no clue.
 *  2. THE FLAT-BAG DEDUPE THROUGH THE WIRE: a body carrying the Person id
 *     `lip-state-bold-red` AND the Styling id `makeup-bold-lips` must emit the
 *     lipstick clause ONCE. This is the test that fails the day someone
 *     "tidies" the wire into nested `person` / `styling` sub-records.
 */

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

describe("subjectSchema — what it accepts", () => {
  it("takes a flat bag of ids in the platform's own field vocabulary", () => {
    expect(
      subjectSchema.parse({
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

  it("accepts the empty string — the renderer drops it, so rejecting would be a new 400", () => {
    expect(subjectSchema.parse({ type: "" })).toEqual({})
  })

  it("accepts an over-generous pick count and CAPS it instead of 400ing", () => {
    expect(
      subjectSchema.parse({
        jewelry: ["jewelry-subtle", "jewelry-statement", "jewelry-gold", "jewelry-silver"],
      }),
    ).toEqual({ jewelry: ["jewelry-subtle", "jewelry-statement", "jewelry-gold"] })
  })

  it("accepts the customAge number and clamps its range", () => {
    expect(subjectSchema.parse({ age: "age-custom", customAge: 34.6 })).toEqual({
      age: "age-custom",
      customAge: 35,
    })
    expect(subjectSchema.parse({ customAge: 9999 })).toEqual({ customAge: 120 })
  })

  it("STRIPS unknown keys at the door, so jobs.input_data stays platform vocabulary", () => {
    expect(subjectSchema.parse({ type: "woman", notAField: "x", preText: "prose" })).toEqual({
      type: "woman",
    })
  })

  it("normalizes an all-unknown bag to {} — the two structured-mode callers must agree", () => {
    expect(subjectSchema.parse({ notAField: "x" })).toEqual({})
  })
})

describe("subjectSchema — the two deliberate 400s", () => {
  it("rejects an array longer than SUBJECT_ARRAY_CEILING", () => {
    const many = Array.from({ length: SUBJECT_ARRAY_CEILING + 1 }, (_, i) => `id-${i}`)
    expect(subjectSchema.safeParse({ jewelry: many }).success).toBe(false)
    expect(subjectSchema.safeParse({ jewelry: many.slice(0, SUBJECT_ARRAY_CEILING) }).success).toBe(
      true,
    )
  })

  it("rejects an id longer than SUBJECT_ID_MAX_CHARS", () => {
    expect(subjectSchema.safeParse({ type: "x".repeat(SUBJECT_ID_MAX_CHARS + 1) }).success).toBe(
      false,
    )
    expect(subjectSchema.safeParse({ type: "x".repeat(SUBJECT_ID_MAX_CHARS) }).success).toBe(true)
  })

  it("rejects an over-long key and an over-stuffed record", () => {
    expect(subjectSchema.safeParse({ ["k".repeat(SUBJECT_KEY_MAX_CHARS + 1)]: "x" }).success).toBe(
      false,
    )
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_SUBJECT_KEYS + 1 }, (_, i) => [`k${i}`, "x"]),
    )
    expect(subjectSchema.safeParse(tooMany).success).toBe(false)
  })
})

describe("subjectSchema — a pack dimension survives the wire (the G3 regression)", () => {
  it("strips a pack field when no pack is registered, and keeps it when one is", () => {
    expect(subjectSchema.parse({ sectorAttire: "attire-modest-suit" })).toEqual({})
    registerPersonPack(pack)
    expect(subjectSchema.parse({ sectorAttire: "attire-modest-suit" })).toEqual({
      sectorAttire: "attire-modest-suit",
    })
  })

  it("folds the pack dimension's clause after a round-trip through the schema", () => {
    registerPersonPack(pack)
    const parsed = subjectSchema.parse({ type: "woman", sectorAttire: "attire-modest-suit" })
    expect(renderSubjectHints(parsed, { surface: "image" })).toEqual([
      `${getPersonPromptHint("woman")}, wearing a modest tailored suit`,
    ])
  })
})

describe("subjectSchema — the flat bag, through the wire", () => {
  it("emits the lipstick clause ONCE for the Person + Styling twins", () => {
    const parsed = subjectSchema.parse({
      lipState: "lip-state-bold-red",
      makeup: "makeup-bold-lips",
    })
    const hints = renderSubjectHints(parsed, { surface: "image" })
    expect(hints).toEqual([getPersonPromptHint("lip-state-bold-red")])
    expect(hints.join(" ")).not.toContain(getStylingPromptHint("makeup-bold-lips"))
  })

  it("folds the midriff + navel safety clause once, through the wire", () => {
    const parsed = subjectSchema.parse({
      distinctiveFeature: ["feature-midriff-visible", "feature-navel-visible"],
    })
    expect(renderSubjectHints(parsed, { surface: "image" })).toEqual([
      "wearing a cropped style, midriff and navel visible",
    ])
  })

  it("caps a 2-pick dimension handed the full array ceiling", () => {
    const eight = Array.from({ length: SUBJECT_ARRAY_CEILING }, (_, i) => `texture-${i}`)
    expect(subjectSchema.parse({ skinTexture: eight })).toEqual({
      skinTexture: eight.slice(0, 2),
    })
  })
})
