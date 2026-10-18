// @test-watches backend/src/nodes/** frontend/src/nodes/**
import { describe, it, expect } from "vitest"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { UNIT_NODE_DESCRIPTORS } from "../../../lib/unit-descriptors.js"

/**
 * A migrated node's saved output is byte-for-byte what it was as a legacy
 * node (§5.8 B: units change nothing they do not add). Every unit with one
 * video output stored on generatedVideoUrl reads the same as a legacy member
 * of the same branch (VIDEO_RESULT_TYPES: active result's url ?? the field,
 * kept only when truthy) — over every shape of generatedResults /
 * activeResultIndex / generatedVideoUrl a saved node can carry.
 */
const LEGACY_TWIN = "transcode-video"

const RESULTS: unknown[] = [undefined, null, [], [{ url: "https://r/a.mp4" }], [{ url: "" }], [{}], [{ url: "https://r/a.mp4" }, { url: "https://r/b.mp4" }], [{ url: "" }, { url: "https://r/b.mp4" }]]
const ACTIVE: unknown[] = [undefined, null, 0, 1, 5]
const FIELD: unknown[] = [undefined, "", "https://r/g.mp4"]

const videoUnits = UNIT_NODE_DESCRIPTORS.filter((u) =>
  u.handles.outputs.length === 1 && u.handles.outputs[0]!.kind === "video" && u.handles.outputs[0]!.from === "generatedVideoUrl")

describe("a unit's saved output equals its legacy twin's", () => {
  it("there is a unit to compare (never vacuous while a video unit exists)", () => {
    expect(videoUnits.length).toBeGreaterThan(0)
  })

  for (const u of videoUnits) {
    it(`${u.type} reads every saved shape like ${LEGACY_TWIN}`, () => {
      for (const generatedResults of RESULTS) for (const activeResultIndex of ACTIVE) for (const generatedVideoUrl of FIELD) {
        const data = { generatedResults, activeResultIndex, generatedVideoUrl } as Record<string, unknown>
        const unit = extractSavedNodeOutput({ id: "u", type: u.type, data } as never)
        const legacy = extractSavedNodeOutput({ id: "l", type: LEGACY_TWIN, data } as never)
        expect(unit, JSON.stringify(data)).toEqual(legacy)
      }
    })
  }
})
