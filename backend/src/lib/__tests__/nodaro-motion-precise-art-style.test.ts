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

// The Precise art-style setting (pure): `{ "motion-prism"?: { opener?: "edit" | "restyle" } }`, the default "restyle"
// stored as nothing, answered to the engine under the current and the earlier keys, read tolerantly.
describe("nodaro-motion-precise-art-style", () => {
  it("its key, openers and default mirror the engine's", () => {
    expect(NODARO_MOTION_PRECISE_ART_STYLE_KEY).toBe("nodaro_motion_precise_art_style")
    expect(PRECISE_ART_STYLE_OPENERS).toEqual(["edit", "restyle"])
    expect(PRECISE_ART_STYLE_OPENER_DEFAULT).toBe("restyle")
  })

  it("leaves the default out: only an engine on \"edit\" is kept", () => {
    expect(withoutDefaultPreciseArtStyle(null)).toEqual({})
    expect(withoutDefaultPreciseArtStyle({ "motion-prism": { opener: "restyle" }, "motion-pulse": {} })).toEqual({})
    expect(withoutDefaultPreciseArtStyle({ "motion-prism": { opener: "edit" } })).toEqual({ "motion-prism": { opener: "edit" } })
    expect(anyPreciseArtStyleChange({ "motion-prism": { opener: "restyle" } })).toBe(false)
    expect(anyPreciseArtStyleChange({ "motion-prism": { opener: "edit" } })).toBe(true)
  })

  it("an engine's opener: \"restyle\" unless the setting says \"edit\"", () => {
    expect(preciseArtStyleOpenerOf(null, "motion-prism")).toBe("restyle")
    expect(preciseArtStyleOpenerOf({ "motion-pulse": { opener: "edit" } }, "motion-prism")).toBe("restyle")
    expect(preciseArtStyleOpenerOf({ "motion-prism": { opener: "edit" } }, "motion-prism")).toBe("edit")
  })

  it("answers the engine each change under its current and earlier key, new objects; null when nothing changed", () => {
    expect(preciseArtStyleForPlugin(null)).toBeNull()
    expect(preciseArtStyleForPlugin({ "motion-prism": { opener: "restyle" } })).toBeNull()
    const setting = { "motion-prism": { opener: "edit" as const } }
    const answer = preciseArtStyleForPlugin(setting)
    expect(answer).toEqual({ "motion-prism": { opener: "edit" }, "motion-pro": { opener: "edit" } })
    answer!["motion-prism"]!.opener = "restyle"
    expect(setting["motion-prism"].opener).toBe("edit")
  })

  it("reads a stored row tolerantly: an earlier key as the current one, an invalid entry dropped with a warning, the default left out", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseArtStyle(null, warn)).toBeNull()
    expect(parseNodaroMotionPreciseArtStyle("edit", warn)).toBeNull()
    expect(parseNodaroMotionPreciseArtStyle({ "motion-pro": { opener: "edit" } }, warn)).toEqual({ "motion-prism": { opener: "edit" } })
    expect(parseNodaroMotionPreciseArtStyle({ "motion-prism": { opener: "shout" }, "motion-pulse": { opener: "restyle" } }, warn)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it("keeps the Precise runs' own style-refs step as picked (Off included); only Edit or the step On is a change that needs an engine", () => {
    const off = { mode: "off" as const, send: "styled" as const, prompt: "Draw {style}." }
    expect(withoutDefaultPreciseArtStyle({ "motion-prism": { styleRefs: off } })).toEqual({ "motion-prism": { styleRefs: off } })
    expect(anyPreciseArtStyleChange({ "motion-prism": { styleRefs: off } })).toBe(false)
    expect(anyPreciseArtStyleChange({ "motion-prism": { styleRefs: { mode: "on" } } })).toBe(true)
    expect(preciseArtStyleForPlugin({ "motion-prism": { opener: "restyle", styleRefs: { mode: "on" } } })).toEqual({
      "motion-prism": { styleRefs: { mode: "on" } },
      "motion-pro": { styleRefs: { mode: "on" } },
    })
    // Read back from the row, a step the stored rules refuse drops that engine's entry (warned), the others kept.
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseArtStyle({ "motion-prism": { styleRefs: { mode: "on", send: "nope" } } }, warn)).toEqual({})
    expect(parseNodaroMotionPreciseArtStyle({ "motion-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } } }, warn)).toEqual({
      "motion-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } },
    })
  })

  it("an entry's save-time problems: none for an opener, nor for a style-refs step the stored rules take", () => {
    expect(preciseArtStyleEntryProblems("preciseArtStyle.motion-prism", { opener: "edit" })).toEqual([])
    expect(preciseArtStyleEntryProblems("preciseArtStyle.motion-prism", { styleRefs: { mode: "on", prompt: "Draw {style}." } })).toEqual([])
  })

  it("the entry schema refuses a style-refs step the steps' rules refuse: a blank or over-long instruction, an unknown send", () => {
    for (const styleRefs of [{ mode: "on", prompt: "   " }, { mode: "on", prompt: "x".repeat(4001) }, { mode: "on", send: "nope" }, { mode: "on", extra: 1 }]) {
      expect(nodaroMotionPreciseArtStyleSchema.safeParse({ "motion-prism": { styleRefs } }).success, JSON.stringify(styleRefs).slice(0, 60)).toBe(false)
    }
    expect(nodaroMotionPreciseArtStyleSchema.parse({ "motion-prism": { styleRefs: { mode: "on", prompt: "  Draw {style}.  " } } })).toEqual({
      "motion-prism": { styleRefs: { mode: "on", prompt: "Draw {style}." } },
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
