import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_PRECISE_ART_STYLE_KEY,
  PRECISE_ART_STYLE_OPENERS,
  PRECISE_ART_STYLE_OPENER_DEFAULT,
  anyPreciseArtStyleChange,
  engineTakesPreciseArtStyle,
  engineTakesPreciseArtStyleAlone,
  parseNodaroMotionPreciseArtStyle,
  nodaroMotionPreciseArtStyleSchema,
  preciseArtStyleEntryProblems,
  preciseArtStyleForPlugin,
  preciseArtStyleOpenerOf,
  withoutDefaultPreciseArtStyle,
} from "../nodaro-motion-precise-art-style.js"

// The Precise art-style setting (pure): `{ "nodaro-prism"?: { opener?: "edit" | "restyle" } }`, the default "restyle"
// stored as nothing, answered to the engine under the current and the earlier keys, read tolerantly.
describe("nodaro-motion-precise-art-style", () => {
  it("its key, openers and default mirror the engine's", () => {
    expect(NODARO_MOTION_PRECISE_ART_STYLE_KEY).toBe("nodaro_motion_precise_art_style")
    expect(PRECISE_ART_STYLE_OPENERS).toEqual(["edit", "restyle"])
    expect(PRECISE_ART_STYLE_OPENER_DEFAULT).toBe("restyle")
  })

  it("leaves the default out: only an engine on \"edit\" is kept", () => {
    expect(withoutDefaultPreciseArtStyle(null)).toEqual({})
    expect(withoutDefaultPreciseArtStyle({ "nodaro-prism": { opener: "restyle" }, "nodaro-pulse": {} })).toEqual({})
    expect(withoutDefaultPreciseArtStyle({ "nodaro-prism": { opener: "edit" } })).toEqual({ "nodaro-prism": { opener: "edit" } })
    expect(anyPreciseArtStyleChange({ "nodaro-prism": { opener: "restyle" } })).toBe(false)
    expect(anyPreciseArtStyleChange({ "nodaro-prism": { opener: "edit" } })).toBe(true)
  })

  it("an engine's opener: \"restyle\" unless the setting says \"edit\"", () => {
    expect(preciseArtStyleOpenerOf(null, "nodaro-prism")).toBe("restyle")
    expect(preciseArtStyleOpenerOf({ "nodaro-pulse": { opener: "edit" } }, "nodaro-prism")).toBe("restyle")
    expect(preciseArtStyleOpenerOf({ "nodaro-prism": { opener: "edit" } }, "nodaro-prism")).toBe("edit")
  })

  it("answers the engine each change under its current and earlier key, new objects; null when nothing changed", () => {
    expect(preciseArtStyleForPlugin(null)).toBeNull()
    expect(preciseArtStyleForPlugin({ "nodaro-prism": { opener: "restyle" } })).toBeNull()
    const setting = { "nodaro-prism": { opener: "edit" as const } }
    const answer = preciseArtStyleForPlugin(setting)
    expect(answer).toEqual({ "nodaro-prism": { opener: "edit" }, "motion-prism": { opener: "edit" }, "motion-pro": { opener: "edit" } })
    answer!["nodaro-prism"]!.opener = "restyle"
    expect(setting["nodaro-prism"].opener).toBe("edit")
  })

  it("reads a stored row tolerantly: an earlier key as the current one, an invalid entry dropped with a warning, the default left out", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseArtStyle(null, warn)).toBeNull()
    expect(parseNodaroMotionPreciseArtStyle("edit", warn)).toBeNull()
    expect(parseNodaroMotionPreciseArtStyle({ "motion-pro": { opener: "edit" } }, warn)).toEqual({ "nodaro-prism": { opener: "edit" } })
    expect(parseNodaroMotionPreciseArtStyle({ "nodaro-prism": { opener: "shout" }, "nodaro-pulse": { opener: "restyle" } }, warn)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it("keeps the Precise runs' own style-refs step as picked (Off included); only Edit or the step On is a change that needs an engine", () => {
    const off = { mode: "off" as const, send: "styled" as const, prompt: "Draw {style}." }
    expect(withoutDefaultPreciseArtStyle({ "nodaro-prism": { styleRefs: off } })).toEqual({ "nodaro-prism": { styleRefs: off } })
    expect(anyPreciseArtStyleChange({ "nodaro-prism": { styleRefs: off } })).toBe(false)
    expect(anyPreciseArtStyleChange({ "nodaro-prism": { styleRefs: { mode: "on" } } })).toBe(true)
    expect(preciseArtStyleForPlugin({ "nodaro-prism": { opener: "restyle", styleRefs: { mode: "on" } } })).toEqual({
      "nodaro-prism": { styleRefs: { mode: "on" } },
      "motion-prism": { styleRefs: { mode: "on" } },
      "motion-pro": { styleRefs: { mode: "on" } },
    })
    // Read back from the row, a step the stored rules refuse drops that engine's entry (warned), the others kept.
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseArtStyle({ "nodaro-prism": { styleRefs: { mode: "on", send: "nope" } } }, warn)).toEqual({})
    expect(parseNodaroMotionPreciseArtStyle({ "nodaro-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } } }, warn)).toEqual({
      "nodaro-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } },
    })
  })

  it("an entry's save-time problems: none for an opener, nor for a style-refs step the stored rules take", () => {
    expect(preciseArtStyleEntryProblems("preciseArtStyle.nodaro-prism", { opener: "edit" })).toEqual([])
    expect(preciseArtStyleEntryProblems("preciseArtStyle.nodaro-prism", { styleRefs: { mode: "on", prompt: "Draw {style}." } })).toEqual([])
  })

  it("the entry schema refuses a style-refs step the steps' rules refuse: a blank or over-long instruction, an unknown send", () => {
    for (const styleRefs of [{ mode: "on", prompt: "   " }, { mode: "on", prompt: "x".repeat(4001) }, { mode: "on", send: "nope" }, { mode: "on", extra: 1 }]) {
      expect(nodaroMotionPreciseArtStyleSchema.safeParse({ "nodaro-prism": { styleRefs } }).success, JSON.stringify(styleRefs).slice(0, 60)).toBe(false)
    }
    expect(nodaroMotionPreciseArtStyleSchema.parse({ "nodaro-prism": { styleRefs: { mode: "on", prompt: "  Draw {style}.  " } } })).toEqual({
      "nodaro-prism": { styleRefs: { mode: "on", prompt: "Draw {style}." } },
    })
  })

  it("an engine takes it only when it declares castSwap.preciseArtStyle", () => {
    expect(engineTakesPreciseArtStyle(undefined)).toBe(false)
    expect(engineTakesPreciseArtStyle({})).toBe(false)
    expect(engineTakesPreciseArtStyle({ preciseArtStyle: false })).toBe(false)
    expect(engineTakesPreciseArtStyle({ preciseArtStyle: true })).toBe(true)
  })

  it("an engine takes an art style alone only when it declares castSwap.preciseArtStyleAlone", () => {
    expect(engineTakesPreciseArtStyleAlone(undefined)).toBe(false)
    expect(engineTakesPreciseArtStyleAlone({})).toBe(false)
    expect(engineTakesPreciseArtStyleAlone({ preciseArtStyleAlone: false })).toBe(false)
    expect(engineTakesPreciseArtStyleAlone({ preciseArtStyleAlone: true })).toBe(true)
  })
})
