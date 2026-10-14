/**
 * A new Generate Video node starts at the API's default duration. It started at
 * 5 s while the API defaults to DEFAULT_VIDEO_DURATION_SEC (4 s), and on
 * Seedance 2 Fast (the node's default model) 5 s bills the 8 s tier — a new
 * node's first run cost about twice the API default. The value is a literal in
 * NODE_DEFINITIONS (gen-skills reads the file as text), so this pins it.
 */
import { describe, it, expect } from "vitest"
import { DEFAULT_VIDEO_DURATION_SEC } from "@nodaro/shared/models"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { NODE_DEF_MAP } from "../nodes"

// Image to Video too (2026-10-14): at 5 s a new node also started on a length
// an account that never paid cannot run (the free-credit video limits, 4 s).
describe.each(["generate-video", "image-to-video"])("%s default duration", (type) => {
  const defaults = NODE_DEF_MAP.get(type as never)?.defaultData as { provider?: string; duration?: number }

  it("is the API's default", () => {
    expect(defaults.duration).toBe(DEFAULT_VIDEO_DURATION_SEC)
  })

  it("is a duration the default model offers", () => {
    expect(MODEL_CATALOG[defaults.provider!]?.durations).toContain(defaults.duration)
  })
})
