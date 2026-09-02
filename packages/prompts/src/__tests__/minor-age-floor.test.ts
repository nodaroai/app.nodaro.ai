import { describe, it, expect } from "vitest"
import { buildPersonHints } from "../person.js"
import { buildStylingHints } from "../styling.js"
import { getAdultOnlyEntries, applyMinorAgeFloorToPickerValues, getAdultOnlyHintStrings, ADULT_SWEPT_CATALOG_IDS, FLOORED_PICKER_KEYS } from "../age-floor.js"

/** The seven P0 prompts' shape (2026-07-30): a 5-year-old + fitted clothing +
 *  parted lips + baby-soft skin + direct gaze. Assembled from picker values —
 *  the stored prompts are never replayed. */
const CHILD = {
  type: "boy-next-door",
  age: "age-young-child",
  frame: "frame-slim",
  lipState: ["lip-state-parted"],
  eyeState: ["eye-state-staring-camera"],
  skinTexture: ["texture-baby-soft"],
} as const

describe("Layer 1 — the collectors drop adultOnly entries for a minor", () => {
  it("a child with flagged lip/eye/skin picks emits none of their hints, keeps the rest", () => {
    const hints = buildPersonHints({ ...CHILD, bust: "bust-very-full", distinctiveFeature: ["feature-midriff-visible"] } as never)
    const joined = hints.join(", ")
    expect(joined).toContain("a young child around 5 years old")
    expect(joined).toContain("slim")
    expect(joined).not.toMatch(/bust|midriff|lips slightly parted|soft breath/i)
    // eye-state-staring-camera and texture-baby-soft are NOT flagged — they stay.
    expect(joined).toContain("staring directly at the camera with unbroken eye contact")
  })

  it("compact mode drops the same ids", () => {
    const terms = buildPersonHints({ ...CHILD, bust: "bust-very-full", lipState: ["lip-state-glossy"] } as never, "compact")
    expect(terms.join(", ")).not.toMatch(/bust|glossy/i)
  })

  it("styling on the flat subject bag drops flagged garments when the bag says minor", () => {
    const hints = buildStylingHints({ age: "age-child", wardrobeState: ["state-fitted"], top: "top-crop-top", outfit: "outfit-bikini" } as never)
    const joined = hints.join(", ")
    expect(joined).not.toMatch(/hugging the contours|bikini/i)
    expect(joined).toMatch(/cropped top/i) // top-crop-top is deliberately NOT flagged
  })

  it("styling with no age signal on the bag is untouched (separate-node consumers; Layer 2 covers them)", () => {
    const hints = buildStylingHints({ wardrobeState: ["state-fitted"] } as never)
    expect(hints.join(", ")).toMatch(/hugging the contours/i)
  })

  it("adults are byte-identical to before: every flagged entry still emits for age-30s", () => {
    for (const e of getAdultOnlyEntries().filter((x) => x.id.startsWith("bust-") || x.id.startsWith("lip-state-"))) {
      const field = e.id.startsWith("bust-") ? "bust" : "lipState"
      const value = field === "bust" ? e.id : [e.id]
      const hints = buildPersonHints({ age: "age-30s", [field]: value } as never)
      expect(hints.join(" "), e.id).toContain(e.promptHint)
    }
  })

  it("a minor-implying type with no age is floored too", () => {
    const hints = buildPersonHints({ type: "alice-wonderland", bust: "bust-full" } as never)
    expect(hints.join(", ")).not.toMatch(/bust/i)
  })
})

describe("applyMinorAgeFloorToPickerValues", () => {
  it("strips flagged ids from person/styling/pose/mood when the person is a minor", () => {
    const out = applyMinorAgeFloorToPickerValues({
      person: { age: "age-early-teen", bust: "bust-full", lipState: ["lip-state-glossy", "lip-state-bold-red"] },
      styling: { top: "top-bra-top", wardrobeState: ["state-fitted", "state-layered"] },
      pose: { pose: "arched-back" },
      mood: { mood: ["sultry", "calm"] },
    })
    expect(out.person).toEqual({ age: "age-early-teen", lipState: ["lip-state-bold-red"] })
    expect(out.styling).toEqual({ wardrobeState: ["state-layered"] })
    expect(out.pose).toEqual({})
    expect(out.mood).toEqual({ mood: ["calm"] })
  })

  it("is the identity for an adult", () => {
    const values = { person: { age: "age-30s", bust: "bust-full" }, styling: { top: "top-bra-top" } }
    expect(applyMinorAgeFloorToPickerValues(values)).toBe(values)
  })

  // The final-review gap: `photo-genre` is swept for the flag
  // (ADULT_SWEPT_CATALOG_IDS) but the hand-written strip list omitted it, so a
  // minor kept `glamour-portrait` / `brand-helmut-newton`. FLOORED_PICKER_KEYS
  // is derived from the sweep list now, which is what makes this pass.
  it("strips a flagged photo-genre id from a minor's values", () => {
    // The real analyzer field for this picker is `photoGenre`
    // (picker-analyzer-registry.ts) — `stripIds` drops by VALUE, so the key
    // name is immaterial; both shapes are pinned so neither can regress.
    const out = applyMinorAgeFloorToPickerValues({
      person: { age: "age-child" },
      "photo-genre": { photoGenre: "glamour-portrait" },
    })
    expect(out["photo-genre"]).toEqual({})

    const coordinatorShape = applyMinorAgeFloorToPickerValues({
      person: { age: "age-child" },
      "photo-genre": { genre: "glamour-portrait" },
    })
    expect(coordinatorShape["photo-genre"]).toEqual({})
  })

  it("an adult keeps the same photo-genre id (identity)", () => {
    const values = { person: { age: "age-30s" }, "photo-genre": { photoGenre: "glamour-portrait" } }
    expect(applyMinorAgeFloorToPickerValues(values)).toBe(values)
  })

  // Totality: the strip list can never again be a subset of the sweep list.
  it("every swept catalog is a floored picker key, and person leads the list", () => {
    for (const id of ADULT_SWEPT_CATALOG_IDS) {
      expect(FLOORED_PICKER_KEYS as ReadonlyArray<string>, id).toContain(id)
    }
    expect(FLOORED_PICKER_KEYS[0]).toBe("person")
    expect(FLOORED_PICKER_KEYS).toHaveLength(ADULT_SWEPT_CATALOG_IDS.length + 1)
  })
})

describe("getAdultOnlyHintStrings", () => {
  it("contains the seven-prompt trigger clause and is longest-first", () => {
    const strings = getAdultOnlyHintStrings()
    expect(strings).toContain("the clothing fitted and form-conscious, hugging the contours of the body")
    expect(strings.length).toBeGreaterThan(0)
    for (let i = 1; i < strings.length; i++) expect(strings[i - 1].length).toBeGreaterThanOrEqual(strings[i].length)
  })

  it("excludes bare derived terms that are absent from every promptHint (fix round 1: promptHint-only)", () => {
    const strings = getAdultOnlyHintStrings()
    // "lounging" (pose id/label, no explicit term — deriveTerm(label) would
    // back-fill it in the composed catalog) and "cropped top" (state-cropped's
    // explicit `term`, distinct from its promptHint "the top cropped above the
    // midriff with the stomach visible") are exactly the short, generic strings
    // that over-strip unrelated benign text when swept as needles.
    expect(strings).not.toContain("lounging")
    expect(strings).not.toContain("cropped top")
    expect(strings).not.toContain("school uniform")
    expect(strings).not.toContain("lying down")
  })
})
