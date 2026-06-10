import { describe, it, expect } from "vitest"
import { applySlots } from "../lottie-slots.js"

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
