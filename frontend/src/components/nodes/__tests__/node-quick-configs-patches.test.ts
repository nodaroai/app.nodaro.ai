import { describe, it, expect } from "vitest"
import {
  getQuickConfigs,
  quickConfigChoicePatch,
  quickConfigSnapPatch,
  quickConfigOptionValue,
  isInQuickConfigRange,
  quickConfigRetainedOption,
  resolveQuickConfigOptions,
  type QuickConfigControl,
} from "../node-quick-configs"

/**
 * The strip's write and fail-safe snap, as pure functions. The strip (QuickConfigSelect) and a published app's
 * card for a strip-derived field both apply them, so the two can never write different data for one choice.
 * The asymmetry is deliberate and pinned here: a USER choice passes the node's data to `write` and applies
 * `additionalClear`; the fail-safe snap calls `write` without data and clears nothing else.
 */
const control = (type: string, field: string): QuickConfigControl => {
  const c = getQuickConfigs(type).find((q) => q.field === field)
  if (!c) throw new Error(`${type} has no ${field} control`)
  return c
}

describe("quickConfigChoicePatch — what a user's choice writes", () => {
  it("coerces a numeric control's option to a number", () => {
    expect(quickConfigChoicePatch(control("switchx", "maxResolution"), "720")).toEqual({ maxResolution: 720 })
  })

  it("coerces a boolean control's option to a boolean", () => {
    expect(quickConfigChoicePatch(control("suno-generate", "instrumental"), "true")).toEqual({ instrumental: true })
    expect(quickConfigChoicePatch(control("suno-generate", "instrumental"), "false")).toEqual({ instrumental: false })
  })

  it("writes undefined for a sentinel option", () => {
    expect(quickConfigChoicePatch(control("suno-generate", "vocalGender"), "auto")).toEqual({ vocalGender: undefined })
  })

  it("applies additionalClear on a user choice", () => {
    expect(quickConfigChoicePatch(control("generate-image", "provider"), "flux")).toEqual({ provider: "flux", providers: undefined })
  })

  it("uses the control's projection, with the node's data", () => {
    const draft = control("video-to-video", "draft")
    expect(quickConfigChoicePatch(draft, "draft", { provider: "seedance-2-5" })).toEqual({ draft: true, v2vResolution: "480p" })
    expect(quickConfigChoicePatch(draft, "full", { provider: "seedance-2-5" })).toEqual({ draft: undefined })
    // Text to Speech's model switch also clears what the new model does not take — that patch reads the data.
    const tts = control("text-to-speech", "provider")
    const withData = quickConfigChoicePatch(tts, "elevenlabs-v3", { provider: "elevenlabs-v4", languageCode: "xx" })
    expect(withData.provider).toBe("elevenlabs-v3")
  })
})

describe("quickConfigSnapPatch — the fail-safe for a stale value", () => {
  const v2vRes = control("video-to-video", "v2vResolution")

  it("leaves an unset value alone", () => {
    expect(quickConfigSnapPatch(v2vRes, "", resolveQuickConfigOptions(v2vRes, {}), {})).toBeUndefined()
  })

  it("leaves a valid value alone", () => {
    const data = { provider: "wan", v2vResolution: "720p" }
    expect(quickConfigSnapPatch(v2vRes, "720p", resolveQuickConfigOptions(v2vRes, data), data)).toBeUndefined()
  })

  it("snaps a stale value to the first valid option", () => {
    const data = { provider: "wan", v2vResolution: "480p" }
    const options = resolveQuickConfigOptions(v2vRes, data)
    expect(quickConfigSnapPatch(v2vRes, "480p", options, data)).toEqual({ v2vResolution: options[0]!.value })
  })

  it("clears the value when the provider has no such lever", () => {
    const data = { provider: "runway-aleph", v2vResolution: "720p" }
    expect(resolveQuickConfigOptions(v2vRes, data)).toEqual([])
    expect(quickConfigSnapPatch(v2vRes, "720p", [], data)).toEqual({ v2vResolution: undefined })
  })

  it("keeps a preserveOnHide value when the lever hides", () => {
    const vocal = control("suno-generate", "vocalGender")
    expect(quickConfigSnapPatch(vocal, "male", [], { instrumental: true })).toBeUndefined()
  })

  it("never snaps an in-range custom numeric", () => {
    const dur = control("generate-video-pro", "duration")
    expect(isInQuickConfigRange(dur, "46")).toBe(true)
    expect(quickConfigSnapPatch(dur, "46", resolveQuickConfigOptions(dur, {}), {})).toBeUndefined()
  })

  it("coerces a snapped numeric and does not apply additionalClear", () => {
    const res = control("switchx", "maxResolution")
    expect(quickConfigSnapPatch(res, "4000", resolveQuickConfigOptions(res, {}), {})).toEqual({ maxResolution: 1080 })
    const img = control("generate-image", "provider")
    const patch = quickConfigSnapPatch(img, "no-such-model", resolveQuickConfigOptions(img, {}), {})
    expect(patch).toBeDefined()
    expect(Object.keys(patch!)).toEqual(["provider"])
  })
})

describe("quickConfigOptionValue — the node-data value an option stands for", () => {
  it("is the coerced value, or what the projection writes into the control's own field", () => {
    expect(quickConfigOptionValue(control("switchx", "maxResolution"), "720")).toBe(720)
    expect(quickConfigOptionValue(control("suno-generate", "instrumental"), "true")).toBe(true)
    expect(quickConfigOptionValue(control("suno-generate", "vocalGender"), "auto")).toBeUndefined()
    expect(quickConfigOptionValue(control("video-to-video", "draft"), "draft")).toBe(true)
    expect(quickConfigOptionValue(control("video-to-video", "draft"), "full")).toBeUndefined()
    expect(quickConfigOptionValue(control("video-to-video", "provider"), "wan")).toBe("wan")
  })
})

describe("a retired LLM model a saved node still carries", () => {
  // gemini-3.7-flash is retired: no menu offers it, but a node that stored it
  // keeps running it. The strip must neither list it nor snap it away.
  for (const [type, field] of [["image-to-text", "llmModel"], ["describe-to-picker", "llmModel"]] as const) {
    it(`${type}: not offered, never snapped, still labelled`, () => {
      const c = control(type, field)
      const options = resolveQuickConfigOptions(c, {})
      expect(options.map((o) => o.value)).not.toContain("gemini-3.7-flash")
      expect(quickConfigSnapPatch(c, "gemini-3.7-flash", options, { llmModel: "gemini-3.7-flash" })).toBeUndefined()
      expect(quickConfigRetainedOption(c, "gemini-3.7-flash")?.label).toBe("Gemini 3.7 Flash")
      // An id that was never registered is still a stale value and snaps.
      expect(quickConfigSnapPatch(c, "not-a-model", options, {})).toBeDefined()
    })
  }
})
