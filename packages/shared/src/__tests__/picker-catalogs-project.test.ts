import { describe, it, expect } from "vitest"
import {
  summarizePickerCatalogs,
  projectPickerCatalog,
  getPickerCatalog,
  PICKER_CATALOGS,
} from "../picker-catalogs.js"

describe("summarizePickerCatalogs", () => {
  it("returns one summary per catalog with a positive optionCount", () => {
    const summary = summarizePickerCatalogs()
    expect(summary.length).toBe(PICKER_CATALOGS.length)
    for (const s of summary) {
      expect(typeof s.nodeType).toBe("string")
      expect(s.optionCount).toBeGreaterThan(0)
      if (s.kind === "single") expect(typeof s.valueField).toBe("string")
      else expect(Array.isArray(s.fields)).toBe(true)
    }
  })
})

describe("projectPickerCatalog", () => {
  it("compact (default) drops description + promptHint on single-dim options", () => {
    const setting = getPickerCatalog("setting")!
    const p = projectPickerCatalog(setting)
    expect(p.detail).toBe("compact")
    expect(p.kind).toBe("single")
    const opt = p.options![0]
    expect(opt.id).toBeTruthy()
    expect(opt.label).toBeTruthy()
    expect(opt.promptHint).toBeUndefined()
    expect(opt.description).toBeUndefined()
  })

  it("full keeps description + promptHint", () => {
    const setting = getPickerCatalog("setting")!
    const p = projectPickerCatalog(setting, { detail: "full" })
    expect(p.options![0].promptHint).toBeTruthy()
  })

  it("category filter narrows single-dim options to that category", () => {
    const setting = getPickerCatalog("setting")!
    const cat = setting.options![0].category!
    const p = projectPickerCatalog(setting, { category: cat })
    expect(p.options!.every((o) => o.category === cat)).toBe(true)
    expect(p.options!.length).toBeLessThan(setting.options!.length)
  })

  it("field filter narrows multi-dim to one dimension", () => {
    const person = getPickerCatalog("person")!
    const field = person.dimensions![0].field
    const p = projectPickerCatalog(person, { field })
    expect(p.kind).toBe("multi")
    expect(p.dimensions!.length).toBe(1)
    expect(p.dimensions![0].field).toBe(field)
  })

  it("unknown category on a single-dim catalog yields empty options, no throw", () => {
    const setting = getPickerCatalog("setting")!
    const p = projectPickerCatalog(setting, { category: "__nope__" })
    expect(p.kind).toBe("single")
    expect(p.options).toEqual([])
  })

  it("unknown field on a multi-dim catalog yields empty dimensions, no throw", () => {
    const person = getPickerCatalog("person")!
    const p = projectPickerCatalog(person, { field: "__nope__" })
    expect(p.kind).toBe("multi")
    expect(p.dimensions).toEqual([])
  })

  it("cross-kind opts are ignored: field on single-dim leaves options intact", () => {
    const setting = getPickerCatalog("setting")!
    const p = projectPickerCatalog(setting, { field: "__nope__" })
    expect(p.kind).toBe("single")
    expect(p.options!.length).toBe(setting.options!.length)
  })

  it("cross-kind opts are ignored: category on multi-dim leaves dimensions intact", () => {
    const person = getPickerCatalog("person")!
    const p = projectPickerCatalog(person, { category: "__nope__" })
    expect(p.kind).toBe("multi")
    expect(p.dimensions!.length).toBe(person.dimensions!.length)
  })
})
