import { describe, it, expect } from "vitest"
import {
  applySlots,
  describeSlotControl,
  rgbaArrayToHex,
  hexToRgbaArray,
  listSlotSids,
  humanizeSlotSid,
  deriveLottieSlotFields,
  LOTTIE_SLOT_FIELD_PREFIX,
} from "../lottie-slots.js"

const slots = {
  primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } }, // canonical: p = property object
  nameText: { p: "Jane Doe" },                     // raw value form
}

describe("applySlots", () => {
  it("replaces a {sid} property with the slot default (property-object p)", () => {
    const lottie = { layers: [{ shapes: [{ ty: "fl", c: { sid: "primaryColor" } }] }] }
    const out = applySlots(lottie, slots, {})
    expect((out as any).layers[0].shapes[0].c).toEqual({ a: 0, k: [1, 0, 0, 1] })
  })

  it("override wins over default and is wrapped as {a:0,k:value} preserving property-object shape", () => {
    const lottie = { layers: [{ shapes: [{ ty: "fl", c: { sid: "primaryColor" } }] }] }
    const out = applySlots(lottie, slots, { primaryColor: [0, 1, 0, 1] })
    expect((out as any).layers[0].shapes[0].c).toEqual({ a: 0, k: [0, 1, 0, 1] })
  })

  it("substitutes raw slot values verbatim (text-document position)", () => {
    // s.t is a RAW STRING position (lottie-web's buildFinalText iterates chars);
    // the slot's bare-string p must land there unwrapped.
    const lottie = { layers: [{ t: { d: { k: [{ s: { t: { sid: "nameText" } } }] } } }] }
    const out = applySlots(lottie, slots, {})
    expect((out as any).layers[0].t.d.k[0].s.t).toBe("Jane Doe")
  })

  it("raw override on a raw-default slot substitutes verbatim", () => {
    const lottie = { layers: [{ t: { d: { k: [{ s: { t: { sid: "nameText" } } }] } } }] }
    const out = applySlots(lottie, { nameText: { p: "Jane Doe" } }, { nameText: "Ada Lovelace" })
    const value = (out as any).layers[0].t.d.k[0].s.t
    expect(value).toBe("Ada Lovelace")
    expect(typeof value).toBe("string")
  })

  it("point slot ([x,y] property object) round-trips with an override", () => {
    const lottie = { layers: [{ shapes: [{ ty: "rc", s: { sid: "barSize" } }] }] }
    const out = applySlots(lottie, { barSize: { p: { a: 0, k: [360, 6] } } }, { barSize: [400, 8] })
    expect((out as any).layers[0].shapes[0].s).toEqual({ a: 0, k: [400, 8] })
  })

  it("override on a missing-slot sid substitutes the raw override verbatim", () => {
    const lottie = { layers: [{ t: { d: { k: [{ s: { t: { sid: "ghostText" } } }] } } }] }
    const out = applySlots(lottie, {}, { ghostText: "Ada Lovelace" })
    expect((out as any).layers[0].t.d.k[0].s.t).toBe("Ada Lovelace")
  })

  it("missing sid is left untouched", () => {
    const lottie = { layers: [{ shapes: [{ ty: "fl", c: { sid: "ghost" } }] }] }
    const out = applySlots(lottie, {}, {})
    expect((out as any).layers[0].shapes[0].c).toEqual({ sid: "ghost" })
  })

  it("annotation-form sid node is replaced when the slot exists", () => {
    const lottie = { layers: [{ shapes: [{ ty: "fl", c: { a: 0, k: [0, 0, 1, 1], sid: "primaryColor" } }] }] }
    const out = applySlots(lottie, slots, {})
    expect((out as any).layers[0].shapes[0].c).toEqual({ a: 0, k: [1, 0, 0, 1] })
  })

  it("reaches sids nested inside precomp assets and arrays", () => {
    const lottie = { assets: [{ id: "comp_0", layers: [{ shapes: [{ it: [{ ty: "st", c: { sid: "primaryColor" } }] }] }] }] }
    const out = applySlots(lottie, slots, {})
    expect((out as any).assets[0].layers[0].shapes[0].it[0].c).toEqual({ a: 0, k: [1, 0, 0, 1] })
  })

  it("does not mutate any of its inputs", () => {
    const lottie = { layers: [{ shapes: [{ ty: "fl", c: { sid: "primaryColor" } }] }] }
    const lottieCopy = structuredClone(lottie)
    const slotsCopy = structuredClone(slots)
    const overrides = { primaryColor: [0, 1, 0, 1] }
    const overridesCopy = structuredClone(overrides)
    applySlots(lottie, slots, overrides)
    expect(lottie).toEqual(lottieCopy)
    expect(slots).toEqual(slotsCopy)
    expect(overrides).toEqual(overridesCopy)
  })
})

describe("describeSlotControl", () => {
  it("maps RGBA arrays to color (unwrapping property-object p)", () => {
    expect(describeSlotControl({ p: { a: 0, k: [1, 0, 0, 1] } })).toEqual({ kind: "color", value: [1, 0, 0, 1] })
  })
  it("maps strings to text (raw-value p, Amendment 1 bare string)", () => {
    expect(describeSlotControl({ p: "Jane" })).toEqual({ kind: "text", value: "Jane" })
  })
  it("maps numbers to number", () => {
    expect(describeSlotControl({ p: { a: 0, k: 42 } })).toEqual({ kind: "number", value: 42 })
  })
  it("maps 2-vectors to point", () => {
    expect(describeSlotControl({ p: { a: 0, k: [10, 20] } })).toEqual({ kind: "point", value: [10, 20] })
  })
  it("returns null for animated property objects (a:1)", () => {
    expect(describeSlotControl({ p: { a: 1, k: [{ t: 0, s: [0] }] } })).toBeNull()
  })
  it("returns null for unknown shapes and non-objects", () => {
    expect(describeSlotControl({ p: { foo: "bar" } })).toBeNull()
    expect(describeSlotControl({ p: [1, 2, 3] })).toBeNull()
    expect(describeSlotControl(null)).toBeNull()
    expect(describeSlotControl("nope")).toBeNull()
  })
})

describe("color conversion", () => {
  it("round-trips rgba<->hex", () => {
    expect(rgbaArrayToHex([1, 0, 0, 1])).toBe("#ff0000")
    expect(hexToRgbaArray("#ff0000")).toEqual([1, 0, 0, 1])
    expect(hexToRgbaArray("#00ff0080")).toEqual([0, 1, 0, expect.closeTo(0.5, 1)])
  })
  it("emits 8-digit hex when alpha < 1", () => {
    const hex = rgbaArrayToHex([0, 1, 0, 0.5])
    expect(hex).toBe("#00ff0080")
  })
  it("omits the alpha component when alpha === 1", () => {
    expect(rgbaArrayToHex([0, 0, 1, 1])).toBe("#0000ff")
  })
  it("clamps out-of-range components and lowercases output", () => {
    expect(rgbaArrayToHex([2, -1, 0.5, 1])).toBe("#ff0080")
  })
  it("expands #rgb shorthand", () => {
    expect(hexToRgbaArray("#f00")).toEqual([1, 0, 0, 1])
  })
})

describe("listSlotSids", () => {
  it("returns manifest sids in insertion order", () => {
    expect(listSlotSids({ a: { p: 1 }, b: { p: 2 } })).toEqual(["a", "b"])
  })
  it("tolerates undefined", () => {
    expect(listSlotSids(undefined as unknown as Record<string, unknown>)).toEqual([])
  })
})

describe("humanizeSlotSid", () => {
  it("splits camelCase into Title Case", () => {
    expect(humanizeSlotSid("primaryColor")).toBe("Primary Color")
  })
  it("converts snake_case and kebab-case", () => {
    expect(humanizeSlotSid("bar_size")).toBe("Bar Size")
    expect(humanizeSlotSid("name-text")).toBe("Name Text")
  })
  it("handles a digit boundary and a single word", () => {
    expect(humanizeSlotSid("color2")).toBe("Color2")
    expect(humanizeSlotSid("title")).toBe("Title")
  })
})

describe("deriveLottieSlotFields", () => {
  const plan = {
    planType: "lottie-graphic",
    slots: {
      primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } }, // color
      nameText: { p: "Jane Doe" },                     // text
      opacity: { p: { a: 0, k: 0.5 } },                // number ≤ 1 → unit slider
      barWidth: { p: { a: 0, k: 360 } },               // number > 1 → 0..ceil(*2)
      offset: { p: { a: 0, k: [10, 20] } },            // point → SKIPPED
    },
  }

  it("derives one field per non-point slot with prefixed keys + right types/defaults", () => {
    const fields = deriveLottieSlotFields(plan)
    // point slot dropped → 4 fields.
    expect(fields).toHaveLength(4)
    expect(fields.every((f) => f.key.startsWith(LOTTIE_SLOT_FIELD_PREFIX))).toBe(true)

    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]))

    expect(byKey["slot:primaryColor"]).toMatchObject({
      label: "Primary Color",
      type: "color",
      defaultValue: "#ff0000",
    })
    expect(byKey["slot:nameText"]).toMatchObject({
      label: "Name Text",
      type: "text",
      defaultValue: "Jane Doe",
    })
    // 0..1 value → unit slider.
    expect(byKey["slot:opacity"]).toMatchObject({
      type: "slider",
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
    })
    // >1 value → 0..ceil(value*2), step 1.
    expect(byKey["slot:barWidth"]).toMatchObject({
      type: "slider",
      min: 0,
      max: 720,
      step: 1,
      defaultValue: 360,
    })
    // point slot is intentionally not exposed.
    expect(byKey["slot:offset"]).toBeUndefined()
  })

  it("returns [] for an elements (non-lottie) plan", () => {
    expect(deriveLottieSlotFields({ planType: "elements", slots: { a: { p: "x" } } })).toEqual([])
  })

  it("returns [] for undefined / empty / non-object slots", () => {
    expect(deriveLottieSlotFields(undefined)).toEqual([])
    expect(deriveLottieSlotFields({ planType: "lottie-graphic" })).toEqual([])
    expect(deriveLottieSlotFields({ planType: "lottie-graphic", slots: {} })).toEqual([])
  })
})
