// @test-watches tools/units/** frontend/src/nodes/*/unit.json
import { describe, expect, it } from "vitest"
import { resolve } from "node:path"
import { NODE_TYPE_TO_TOOL, unitNodeTools } from "../../../scripts/lib/gen-skills/node-type-to-tool.js"

const ROOT = resolve(__dirname, "../../../..")

describe("NODE_TYPE_TO_TOOL: the hand-written rows ∪ the units' own verbs (unit.json mcp.widgetModelFor)", () => {
  it("a unit naming one verb gets its row from its manifest (gif-to-video → gif_to_video, which it had as a hand-written row)", () => {
    expect(unitNodeTools(ROOT)).toContainEqual(["gif-to-video", "gif_to_video"])
    expect(NODE_TYPE_TO_TOOL["gif-to-video"]).toBe("gif_to_video")
  })

  it("every unit row is in the composed map", () => {
    for (const [type, tool] of unitNodeTools(ROOT)) expect(NODE_TYPE_TO_TOOL[type], type).toBe(tool)
  })
})
