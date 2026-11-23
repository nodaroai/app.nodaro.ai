import { describe, it, expect } from "vitest"
import { generateVideoProviderSnap } from "@/lib/generate-video-provider-snap"
import { ltx25LengthSnap, ltx25OfferedDurations, ltx25SeedInput } from "@/components/editor/config-panels/ltx-2-5-fields"
import { VIDEO_FPS_OPTIONS } from "@/components/editor/config-panels/model-options"

/**
 * LTX 2.5 in the editor: a switch lands on its declared 1080p / 10 s defaults,
 * the lengths offered follow the resolution and frame rate (Fast: 6-10 s at
 * 1440p or 48 / 50 fps), a stored length past them moves to the nearest one
 * the server would send, and the negative prompt it takes none of is cleared.
 */
describe("generateVideoProviderSnap — LTX 2.5", () => {
  it("a switch persists the declared 1080p / 10 s defaults, never the cheapest tier", () => {
    expect(generateVideoProviderSnap({ provider: "seedance-2-fast", resolution: "480p" }, "ltx-2.5-fast")).toMatchObject({ resolution: "1080p", duration: 10 })
    expect(generateVideoProviderSnap({}, "ltx-2.5-pro")).toMatchObject({ resolution: "1080p", duration: 10 })
  })

  it("a stale frame rate snaps to 24; leaving for a model without the setting clears it", () => {
    expect(generateVideoProviderSnap({ resolution: "1080p", duration: 10, fps: 30 }, "ltx-2.5-fast")).toMatchObject({ fps: 24 })
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 8, fps: 50 }, "seedance-2-fast")).toMatchObject({ fps: undefined })
  })

  it("a stored length past Fast's limit at its resolution or frame rate moves down to 10 s", () => {
    expect(generateVideoProviderSnap({ resolution: "1440p", duration: 16 }, "ltx-2.5-fast")).toMatchObject({ duration: 10 })
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 20, fps: 50 }, "ltx-2.5-fast")).toMatchObject({ duration: 10 })
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 20, fps: 25 }, "ltx-2.5-fast")).not.toHaveProperty("duration")
  })

  it("clears a negative prompt (the model takes none)", () => {
    expect(generateVideoProviderSnap({ resolution: "1080p", duration: 10, negativePrompt: "blur" }, "ltx-2.5-pro")).toMatchObject({ negativePrompt: undefined })
    expect(generateVideoProviderSnap({ negativePrompt: "blur" }, "pixverse-v6-max")).not.toHaveProperty("negativePrompt")
  })

  it("leaves an LTX 2.3 node exactly as it was", () => {
    expect(generateVideoProviderSnap({ resolution: "1080p", duration: 16, fps: 25, negativePrompt: "blur" }, "ltx-2.3-fast")).toEqual({})
  })
})

describe("LTX 2.5 panel helpers", () => {
  it("offers the lengths its resolution and frame rate allow", () => {
    expect(ltx25OfferedDurations("ltx-2.5-fast", {})).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
    expect(ltx25OfferedDurations("ltx-2.5-fast", { resolution: "1440p" })).toEqual([6, 8, 10])
    expect(ltx25OfferedDurations("ltx-2.5-fast", { resolution: "1080p", fps: 48 })).toEqual([6, 8, 10])
    expect(ltx25OfferedDurations("ltx-2.5-pro", { fps: 50 })).toEqual([6, 8, 10])
  })

  it("moves a length in view as the server does", () => {
    expect(ltx25LengthSnap("ltx-2.5-fast", { resolution: "1440p", duration: 18 })).toEqual({ duration: 10 })
    expect(ltx25LengthSnap("ltx-2.5-fast", { resolution: "1080p", duration: 18, fps: 25 })).toEqual({})
    expect(ltx25LengthSnap("ltx-2.5-fast", {})).toEqual({})
  })

  it("frame rates from the catalog; LTX 2.3 keeps its own row", () => {
    expect(VIDEO_FPS_OPTIONS["ltx-2.5-fast"]?.map((o) => o.value)).toEqual([24, 25, 48, 50])
    expect(VIDEO_FPS_OPTIONS["ltx-2.5-pro"]?.map((o) => o.value)).toEqual([24, 25, 48, 50])
    expect(VIDEO_FPS_OPTIONS["ltx-2.3-fast"]?.map((o) => o.value)).toEqual([24, 25, 48, 50])
    expect(VIDEO_FPS_OPTIONS["seedance-2-fast"]).toBeUndefined()
  })

  it("a seed is a whole number 0-2147483647", () => {
    expect(ltx25SeedInput("7")).toBe(7)
    expect(ltx25SeedInput("")).toBeUndefined()
    expect(ltx25SeedInput("-1")).toBeUndefined()
  })
})
