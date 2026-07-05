import { describe, it, expect } from "vitest"
import { PEOPLE, PERSON_DIMENSION_ORDER, PERSON_FIELD_BY_DIMENSION, buildPersonHints, migratePersonValue, getPersonPromptHint } from "../index.js"

/**
 * Facial-geometry layer: new Face dimensions + the eye/lips split, plus the
 * backward-compatibility guarantees for already-saved Person data.
 */
describe("facial-geometry catalog", () => {
  const idsFor = (dim: string) => PEOPLE.filter((p) => p.dimension === dim).map((p) => p.id)

  it("registers every new dimension in the canonical order", () => {
    for (const dim of [
      "cheekbones",
      "facial-fullness",
      "eyelid-type",
      "canthal-tilt",
      "eye-spacing",
      "eye-set-brow",
      "nose-tip",
      "lip-fullness",
      "lip-shape",
    ]) {
      expect(PERSON_DIMENSION_ORDER, dim).toContain(dim)
      expect(PERSON_FIELD_BY_DIMENSION[dim as keyof typeof PERSON_FIELD_BY_DIMENSION], dim).toBeTruthy()
      expect(idsFor(dim).length, dim).toBeGreaterThan(0)
    }
  })

  it("dropped `lips` and `philtrum` as dimensions", () => {
    expect(PERSON_DIMENSION_ORDER).not.toContain("lips")
    expect(PERSON_DIMENSION_ORDER).not.toContain("philtrum")
  })

  it("eyelid-type exposes Standard / Hooded / Droopy / Deep-set (droopy is its own value)", () => {
    expect(idsFor("eyelid-type")).toEqual(["eyelid-standard", "eye-hooded", "eye-droopy", "eye-deep-set"])
  })

  it("eye-shape keeps only anatomical shapes (lid/tilt/spacing moved out)", () => {
    expect(idsFor("eye-shape")).toEqual([
      "eye-almond",
      "eye-round",
      "eye-monolid",
      "eye-double-eyelid",
      "eye-wide",
      "eye-narrow",
    ])
  })

  it("every neutral default carries an EMPTY promptHint (enabling injects nothing)", () => {
    for (const id of [
      "cheekbones-average",
      "facial-fullness-average",
      "eyelid-standard",
      "canthal-neutral",
      "eye-spacing-average",
      "eyeset-average",
      "nose-tip-natural",
      "lips-natural",
    ]) {
      expect(getPersonPromptHint(id), id).toBe("")
    }
  })

  it("non-neutral options inject a real fragment", () => {
    expect(getPersonPromptHint("cheekbones-sculpted")).toContain("cheekbones")
    expect(getPersonPromptHint("eye-upturned")).toContain("canthal tilt")
    expect(getPersonPromptHint("nose-tip-upturned")).toContain("nose tip")
    expect(getPersonPromptHint("lips-full-lower")).toContain("lower lip")
  })
})

describe("buildPersonHints — facial geometry composition", () => {
  it("composes the geometry fields in canonical order", () => {
    const hints = buildPersonHints({
      cheekbones: "cheekbones-sculpted",
      facialFullness: "facial-fullness-lean",
      eyeShape: "eye-almond",
      eyelidType: "eye-hooded",
      canthalTilt: "eye-upturned",
      lipFullness: "lips-full",
      lipShape: "lips-cupids-bow",
    })
    const joined = hints.join(", ")
    expect(joined).toContain("sharply sculpted high cheekbones")
    expect(joined).toContain("almond-shaped eyes")
    expect(joined).toContain("hooded eyes")
    expect(joined).toContain("positive canthal tilt")
    expect(joined).toContain("full plump lips")
    expect(joined).toContain("cupid's bow")
    // cheekbones precede eyes precede lips (Face dimension order)
    expect(joined.indexOf("cheekbones")).toBeLessThan(joined.indexOf("almond"))
    expect(joined.indexOf("almond")).toBeLessThan(joined.indexOf("cupid's bow"))
  })

  it("neutral picks contribute nothing", () => {
    expect(buildPersonHints({ cheekbones: "cheekbones-average", noseTip: "nose-tip-natural" })).toEqual([])
  })
})

describe("backward compatibility — legacy saved Person data still resolves", () => {
  it("legacy eyeShape values (relocated dims) still emit their original hint", () => {
    // Old data stored hooded/upturned/wide-set under `eyeShape`; the ids stayed
    // in the catalog, so buildPersonHints (id-based) emits the same phrase.
    expect(buildPersonHints({ eyeShape: "eye-hooded" })).toEqual([
      "hooded eyes with the upper lid partially covering the crease",
    ])
    expect(buildPersonHints({ eyeShape: "eye-wide-set" }).join("")).toContain("wide-set eyes")
  })

  it("legacy `lips` value emits via the fallback when no new lip field is set", () => {
    expect(buildPersonHints({ lips: "lips-cupids-bow" })).toEqual([
      "a pronounced cupid's bow on the upper lip",
    ])
  })

  it("does NOT double-emit when both legacy `lips` and a new lip field are set", () => {
    const hints = buildPersonHints({ lips: "lips-thin", lipFullness: "lips-full" })
    expect(hints).toEqual(["full plump lips"])
  })
})

describe("migratePersonValue", () => {
  it("relocates legacy eyeShape onto the split fields and clears the source", () => {
    expect(migratePersonValue({ eyeShape: "eye-hooded" })).toEqual({ eyeShape: undefined, eyelidType: "eye-hooded" })
    expect(migratePersonValue({ eyeShape: "eye-upturned" })).toEqual({ eyeShape: undefined, canthalTilt: "eye-upturned" })
    expect(migratePersonValue({ eyeShape: "eye-close-set" })).toEqual({ eyeShape: undefined, eyeSpacing: "eye-close-set" })
  })

  it("relocates legacy lips onto fullness/shape", () => {
    expect(migratePersonValue({ lips: "lips-full" })).toEqual({ lips: undefined, lipFullness: "lips-full" })
    expect(migratePersonValue({ lips: "lips-small" })).toEqual({ lips: undefined, lipShape: "lips-small" })
  })

  it("leaves kept eye-shape values and unrelated keys untouched (same reference)", () => {
    const kept = { eyeShape: "eye-almond", label: "Person", type: "woman" }
    expect(migratePersonValue(kept)).toBe(kept)
  })

  it("never overwrites an already-set target field", () => {
    const v = { eyeShape: "eye-hooded", eyelidType: "eye-deep-set" }
    // target already set → leave both as-is (no clobber)
    expect(migratePersonValue(v)).toBe(v)
  })

  it("is idempotent", () => {
    const once = migratePersonValue({ eyeShape: "eye-hooded", lips: "lips-cupids-bow" })
    const twice = migratePersonValue(once)
    expect(twice).toEqual(once)
  })

  it("preserves the same prompt output before and after migration", () => {
    const legacy = { eyeShape: "eye-upturned", lips: "lips-full" }
    const migrated = migratePersonValue(legacy)
    expect(buildPersonHints(migrated)).toEqual(buildPersonHints(legacy))
  })
})
