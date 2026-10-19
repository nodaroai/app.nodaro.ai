// @test-units-by-name checks only the speaker-map entries it names
import { describe, it, expect, afterEach } from "vitest"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, declaredJsonOutput } from "@nodaro/shared/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { getCompatibleNodes } from "@/lib/node-compatibility"
import { EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES } from "@/lib/node-families"
import { JSON_RUN_RESULT_TYPES } from "@/lib/json-run-result"
import { LONG_RUNNING_NODE_TYPES } from "@/lib/single-node-restore"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { definition } from "../definition.generated"

const typeOf = (id: string) =>
  ({ cam: "upload-video", mic: "upload-audio", img: "upload-image", sync: "audio-sync", tx: "transcribe", map: "speaker-map", cs: "camera-switch", llm: "llm-chat" } as Record<string, string>)[id]

describe("Speaker Map is registered everywhere it must be", () => {
  it("definition: Cameras, Offsets and Transcript in; the map and the edit out", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "speaker-map")!
    expect(def.inputs).toEqual(["sources", "offsets", "transcript"])
    expect(def.outputs).toEqual(["json", "edl"])
    expect(def.defaultData).toMatchObject({ label: "Speaker Map" })
  })

  it("a JSON producer (both pips), no media producer, executable, priced 10, not Nodaro-exclusive", () => {
    expect(JSON_PRODUCER_TYPES.has("speaker-map")).toBe(true)
    expect(HANDLE_OUTPUT_TYPES["speaker-map"]).toEqual({ json: "look", edl: "look" })
    expect(VIDEO_PRODUCER_TYPES.has("speaker-map") || AUDIO_PRODUCER_TYPES.has("speaker-map") || DYNAMIC_PRODUCER_TYPES.has("speaker-map")).toBe(false)
    expect(EXECUTABLE_TYPES.has("speaker-map")).toBe(true)
    expect(definition.priceRows["speaker-map"]).toBe(10)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("speaker-map")).toBe(false)
  })

  it("its `json` is neither a Transcript nor an EDL; its `edl` is an EDL", () => {
    expect(declaredJsonOutput("speaker-map", "json")).toBe("other")
    expect(declaredJsonOutput("speaker-map", "edl")).toBe("edl")
  })

  it("a server run lands its JSON like a canvas run, and a reload re-attaches its poll for the long horizon", () => {
    expect(JSON_RUN_RESULT_TYPES.has("speaker-map")).toBe(true)
    expect(LONG_RUNNING_NODE_TYPES.has("speaker-map")).toBe(true)
  })

  it("connections: recordings into Cameras, Audio Sync into Offsets, Transcribe into Transcript — never an image, never a video into Offsets", () => {
    expect(isValidWorkflowConnection({ source: "cam", target: "map", sourceHandle: "video", targetHandle: "sources" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "mic", target: "map", sourceHandle: "audio", targetHandle: "sources" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "sync", target: "map", sourceHandle: "json", targetHandle: "offsets" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "tx", target: "map", sourceHandle: "json", targetHandle: "transcript" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "map", sourceHandle: "image", targetHandle: "sources" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "cam", target: "map", sourceHandle: "video", targetHandle: "offsets" }, typeOf)).toBe(false)
  })

  afterEach(() => __resetSurfaceAvailabilityForTests(null))

  it("its map into Camera Switch's Speaker map, its edit into Camera Switch's EDL; never into a prompt (no generic text read of its JSON)", () => {
    // The Speaker map input follows Speaker Map's availability (hidden until loaded): a viewer offered Speaker Map.
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(isValidWorkflowConnection({ source: "map", target: "cs", sourceHandle: "json", targetHandle: "speakerMap" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "map", target: "cs", sourceHandle: "edl", targetHandle: "edl" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "map", target: "llm", sourceHandle: "json", targetHandle: "prompt" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "map", target: "llm", sourceHandle: "edl", targetHandle: "prompt" }, typeOf)).toBe(false)
  })

  it("a typed JSON source in the add-node popup (TYPED_SOURCE_NODE_TYPES): its pips offer only the typed JSON consumers, never the loose prompt fallback", () => {
    const options = [{ type: "extract-field" }, { type: "camera-switch" }, { type: "generate-image" }, { type: "merge-video-audio" }] as never
    for (const pip of ["json", "edl"]) {
      const offered = getCompatibleNodes(pip, "source", options, "speaker-map")
      expect(offered.compatible, pip).toEqual([])
      expect(offered.direct.map((o) => o.type), pip).toEqual(["extract-field", "camera-switch"])
    }
  })

  it("picker: the Audio → Analyze family, after Audio Sync", () => {
    expect(NODE_FAMILIES.find((f) => f.id === "audio-analyze")!.types).toEqual(["silence-detect", "audio-sync", "speaker-map"])
    expect(NODE_OPTIONS.find((o) => o.type === "speaker-map")!.group).toBe("audio-analyze")
  })
})
