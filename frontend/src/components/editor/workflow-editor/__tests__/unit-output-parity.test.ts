// @test-watches frontend/src/nodes/**
import { describe, it, expect } from "vitest"
import { extractNodeOutput } from "../execution-graph"
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"
import type { WorkflowNode } from "@/types/nodes"

/**
 * A migrated node's output is exactly what it was as a legacy node (§5.8 B:
 * units change nothing they do not add). Every unit with one video output
 * stored on generatedVideoUrl reads the same as a legacy member of the same
 * branch (`results[activeResultIndex ?? 0]?.url ?? generatedVideoUrl`) — over
 * every shape of generatedResults / activeResultIndex / generatedVideoUrl a
 * node can carry.
 */
const LEGACY_TWIN = "transcode-video"

const RESULTS: unknown[] = [undefined, null, [], [{ url: "https://r/a.mp4" }], [{ url: "" }], [{}], [{ url: "https://r/a.mp4" }, { url: "https://r/b.mp4" }], [{ url: "" }, { url: "https://r/b.mp4" }]]
const ACTIVE: unknown[] = [undefined, null, 0, 1, 5]
const FIELD: unknown[] = [undefined, "", "https://r/g.mp4"]

const videoUnits = UNIT_NODE_DEFINITIONS.filter((u) =>
  u.handles.outputs.length === 1 && u.handles.outputs[0]!.kind === "video" && u.handles.outputs[0]!.from === "generatedVideoUrl")

const node = (type: string, data: Record<string, unknown>) => ({ id: type, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode

describe("a unit's output equals its legacy twin's", () => {
  it("there is a unit to compare (never vacuous while a video unit exists)", () => {
    expect(videoUnits.length).toBeGreaterThan(0)
  })

  for (const u of videoUnits) {
    it(`${u.type} reads every shape like ${LEGACY_TWIN}`, () => {
      for (const generatedResults of RESULTS) for (const activeResultIndex of ACTIVE) for (const generatedVideoUrl of FIELD) {
        const data = { label: "x", generatedResults, activeResultIndex, generatedVideoUrl }
        for (const handle of [undefined, u.handles.outputs[0]!.id]) {
          expect(extractNodeOutput(node(u.type, data), handle), `${JSON.stringify(data)} @${handle}`).toEqual(extractNodeOutput(node(LEGACY_TWIN, data), handle))
        }
      }
    })
  }
})
