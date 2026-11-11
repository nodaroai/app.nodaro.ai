import { describe, expect, it } from "vitest"

import { MODEL_CATALOG } from "../model-catalog"
import { VIDEO_TO_VIDEO_NODE_PROVIDERS, isSeedanceVideoEditProvider, videoProviderRequiresImage } from "../model-constants"
import { modelToNodeTarget } from "../model-tree"

/**
 * The catalog's `modes` are what a model can be run for: `/v1/models`, MCP
 * `list_models`, the header's menu categories. Seedance 2.5 edits a clip on the
 * same route as the other edit models (`/v1/video-to-video`, through the
 * reference lane), so the catalog says `v2v` for it, and everything that makes
 * a clip from words or a picture is unchanged by that.
 */
describe("Seedance 2.5 in the catalog", () => {
  const entry = MODEL_CATALOG["seedance-2-5"]!

  it("lists the video-to-video mode the edit route runs it in", () => {
    expect(entry.modes).toContain("v2v")
    expect(VIDEO_TO_VIDEO_NODE_PROVIDERS).toContain("seedance-2-5")
    expect(isSeedanceVideoEditProvider("seedance-2-5")).toBe(true)
  })

  it("is still a model that makes a clip from words or a picture: a generation does not start needing a clip", () => {
    expect(entry.modes).toEqual(expect.arrayContaining(["i2v", "t2v"]))
    // The first mode stays the same for anything that reads the modes in order.
    expect(entry.modes[0]).toBe("i2v")
    expect(videoProviderRequiresImage("seedance-2-5")).toBe(false)
    expect(modelToNodeTarget("seedance-2-5")).toEqual({ nodeType: "generate-video", field: "provider", value: "seedance-2-5" })
  })

  it("is not listed as an extend model: extending is a model of its own", () => {
    expect(entry.modes).not.toContain("extend")
    expect(MODEL_CATALOG["seedance-2-5-extend"]?.modes).toContain("extend")
  })
})
