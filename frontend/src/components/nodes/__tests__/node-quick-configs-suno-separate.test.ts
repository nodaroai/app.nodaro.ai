/**
 * Suno Separate's quick-strip mode pill offers the panel's three modes — the
 * shared SUNO_SEPARATE_TYPES, in order — so one-instrument mode is reachable
 * from the card as well as the panel.
 */
import { describe, it, expect } from "vitest"
import { SUNO_SEPARATE_TYPES } from "@nodaro/shared/models"
import { getQuickConfigs } from "../node-quick-configs"

describe("suno-separate quick-strip mode pill", () => {
  it("lists every separation mode, one instrument included", () => {
    const control = getQuickConfigs("suno-separate").find((c) => c.field === "type")!
    const options = typeof control.options === "function" ? [] : control.options
    expect(options.map((o) => o.value)).toEqual([...SUNO_SEPARATE_TYPES])
    expect(options.every((o) => typeof o.label === "string" && o.label.length > 0)).toBe(true)
  })
})
