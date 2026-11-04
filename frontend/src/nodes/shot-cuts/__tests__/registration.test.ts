// @test-units-by-name checks only the shot-cuts entries it names
import { describe, it, expect } from "vitest"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, declaredJsonOutput } from "@nodaro/shared/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES } from "@/lib/node-families"
import { JSON_RUN_RESULT_TYPES } from "@/lib/json-run-result"
import { LONG_RUNNING_NODE_TYPES } from "@/lib/single-node-restore"
import { definition } from "../definition.generated"
import { formatShotTime, shotCutsResultOf } from "../types"

const typeOf = (id: string) => ({ vid: "upload-video", img: "upload-image", sc: "shot-cuts", ext: "extract-field" } as Record<string, string>)[id]

describe("Shot Cuts is registered everywhere it must be", () => {
  it("definition: a video in; the shots and the first and last frames out; frames off by default", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "shot-cuts")!
    expect(def.inputs).toEqual(["in"])
    expect(def.outputs).toEqual(["json", "firstFrames", "lastFrames"])
    expect(def.defaultData).toMatchObject({ label: "Shot Cuts", frames: false })
  })

  it("right after Split into Chunks, in the node list and in its picker family", () => {
    const types = NODE_DEFINITIONS.map((d) => d.type)
    expect(types.indexOf("shot-cuts")).toBe(types.indexOf("split-media") + 1)
    const family = NODE_FAMILIES.find((f) => f.id === "video-cut-assemble")!
    expect(family.types.indexOf("shot-cuts")).toBe(family.types.indexOf("split-media") + 1)
    expect(NODE_OPTIONS.some((o) => o.type === "shot-cuts")).toBe(true)
  })

  it("a JSON producer (three other-JSON pips), no media producer, executable, priced 1, long-running", () => {
    expect(JSON_PRODUCER_TYPES.has("shot-cuts")).toBe(true)
    expect(HANDLE_OUTPUT_TYPES["shot-cuts"]).toEqual({ json: "look", firstFrames: "look", lastFrames: "look" })
    for (const set of [VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES]) expect(set.has("shot-cuts")).toBe(false)
    for (const pip of ["json", "firstFrames", "lastFrames"]) expect(declaredJsonOutput("shot-cuts", pip)).toBe("other")
    expect(EXECUTABLE_TYPES.has("shot-cuts")).toBe(true)
    expect(definition.priceRows["shot-cuts"]).toBe(1)
    expect(JSON_RUN_RESULT_TYPES.has("shot-cuts")).toBe(true)
    expect(LONG_RUNNING_NODE_TYPES.has("shot-cuts")).toBe(true)
  })

  it("connections: a video into its input, never an image; its shots into a JSON reader", () => {
    expect(isValidWorkflowConnection({ source: "vid", target: "sc", sourceHandle: "video", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "sc", sourceHandle: "image", targetHandle: "in" }, typeOf)).toBe(false)
  })

  it("reads a result off the node (object or the JSON a wire carried), and formats times", () => {
    const result = { shotCount: 1, cutsSec: [], durationSec: 2, shots: [{ index: 0, startSec: 0, endSec: 2, durationSec: 2 }] }
    expect(shotCutsResultOf(result)).toEqual(result)
    expect(shotCutsResultOf(JSON.stringify(result))).toEqual(result)
    expect(shotCutsResultOf("not json")).toBeNull()
    expect(shotCutsResultOf({ shots: [] })).toBeNull()
    expect(formatShotTime(0)).toBe("0:00.000")
    expect(formatShotTime(62.25)).toBe("1:02.250")
    expect(formatShotTime(3725.5)).toBe("1:02:05.500")
  })
})
