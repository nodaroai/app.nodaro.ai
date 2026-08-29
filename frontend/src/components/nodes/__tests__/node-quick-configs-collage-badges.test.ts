/**
 * The image-collage "Numbers" quick-strip pill is a PROJECTION: one dropdown
 * over two data fields (`numbered` + `badgePosition`). These tests pin the
 * projection both ways — what the pill shows for a given node data, and what
 * patch each choice writes — and the generic `read`/`write` hook plumbing that
 * makes such a control possible without teaching the strip about collages.
 */
import { describe, it, expect } from "vitest"
import { getQuickConfigs, readQuickConfigValue, coerceQuickConfigValue } from "../node-quick-configs"

const control = getQuickConfigs("image-collage").find((c) => c.field === "badges")!

describe("image-collage Numbers pill (numbered + badgePosition projection)", () => {
  it("is registered with none / top-left / top-right", () => {
    expect(control).toBeDefined()
    expect(typeof control.options === "function" ? [] : control.options.map((o) => o.value)).toEqual([
      "none",
      "top-left",
      "top-right",
    ])
  })

  it("reads 'none' when numbering is off, whatever the corner is", () => {
    expect(readQuickConfigValue(control, {})).toBe("none")
    expect(readQuickConfigValue(control, { numbered: false, badgePosition: "top-right" })).toBe("none")
  })

  it("reads the corner when numbering is on (absent corner = top-left)", () => {
    expect(readQuickConfigValue(control, { numbered: true })).toBe("top-left")
    expect(readQuickConfigValue(control, { numbered: true, badgePosition: "top-left" })).toBe("top-left")
    expect(readQuickConfigValue(control, { numbered: true, badgePosition: "top-right" })).toBe("top-right")
  })

  it("writes the two fields — top-left stores undefined for the corner (the default), none only turns numbers off", () => {
    expect(control.write!("top-left")).toEqual({ numbered: true, badgePosition: undefined })
    expect(control.write!("top-right")).toEqual({ numbered: true, badgePosition: "top-right" })
    // "None" must NOT touch badgePosition: labels-only badges keep their corner.
    expect(control.write!("none")).toEqual({ numbered: undefined })
    expect("badgePosition" in control.write!("none")).toBe(false)
  })

  it("round-trips: every option reads back as itself after being written", () => {
    for (const v of ["none", "top-left", "top-right"]) {
      const data: Record<string, unknown> = { ...control.write!(v) }
      expect(readQuickConfigValue(control, data)).toBe(v)
    }
  })
})

describe("readQuickConfigValue — plain controls are unchanged", () => {
  it("stringifies data[field] and returns '' when unset", () => {
    const layout = getQuickConfigs("image-collage").find((c) => c.field === "layout")!
    expect(readQuickConfigValue(layout, { layout: "grid" })).toBe("grid")
    expect(readQuickConfigValue(layout, {})).toBe("")
    expect(coerceQuickConfigValue(layout, "grid")).toBe("grid")
  })
})
