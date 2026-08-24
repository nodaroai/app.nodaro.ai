import { describe, it, expect, beforeEach } from "vitest"
import {
  PICKER_CATALOGS, getRegisteredPickerCatalogs, getPickerCatalog, listPickerCatalogs,
} from "../picker-catalogs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

beforeEach(() => resetCatalogPacks())

describe("registered read funnel", () => {
  it("with no packs, registered set equals the frozen base (inert default)", () => {
    expect(getRegisteredPickerCatalogs()).toEqual(PICKER_CATALOGS)
    expect(Object.isFrozen(PICKER_CATALOGS)).toBe(true)
  })

  it("late registration is reflected after the memo invalidates by version", () => {
    const before = getPickerCatalog("setting")!.options!.map((o) => o.id)
    registerCatalogPack({ id: "sai/setting-extend", catalogId: "setting", mode: "extend",
      options: [{ id: "shul-hall", label: "Shul Hall", promptHint: "in a synagogue hall" }] })
    const after = getPickerCatalog("setting")!.options!.map((o) => o.id)
    expect(after).toEqual([...before, "shul-hall"])
    // base is untouched
    expect(PICKER_CATALOGS.find((c) => c.catalogId === "setting")!.options!.some((o) => o.id === "shul-hall")).toBe(false)
  })

  it("listPickerCatalogs reads the registered set", () => {
    registerCatalogPack({ id: "sai/deny", catalogId: "setting", mode: "deny", denyIds: ["forest"] })
    const setting = listPickerCatalogs().find((c) => c.catalogId === "setting")!
    expect(setting.options!.some((o) => o.id === "forest")).toBe(false)
  })
})
