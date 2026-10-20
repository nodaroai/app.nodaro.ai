// @test-units-by-name checks only the speaker-layout entries it names
import { describe, it, expect, afterEach } from "vitest"
import { VIDEO_PRODUCER_TYPES, declaredJsonOutput } from "@nodaro/shared/nodes"
import { SPEAKER_LAYOUT_DEFAULTS, USE_CASE_NODE_TYPES, usecaseDescriptor } from "@nodaro/render-rules"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES } from "@/lib/node-families"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { definition } from "../definition.generated"

const typeOf = (id: string) =>
  ({ cam1: "upload-video", cam2: "upload-video", mic: "upload-audio", img: "upload-image", sl: "speaker-layout", cap: "add-captions", jp: "json-process" } as Record<string, string>)[id]

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("Speaker Layout is registered everywhere it must be", () => {
  it("definition: the recordings and a Master audio in; the framed video and its edit out; the decided defaults", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "speaker-layout")!
    expect(def.label).toBe("Speaker Layout")
    expect(def.category).toBe("processing")
    expect(def.inputs).toEqual(["media", "masterAudio"])
    expect(def.outputs).toEqual(["media", "json"])
    expect(def.defaultData).toMatchObject({
      label: "Speaker Layout",
      targetAspect: "9:16",
      layout: "stacked",
      switchType: "cut",
      emphasisStyle: "scale",
      framingSource: "auto",
      reviewBeforeRender: false,
    })
  })

  it("its defaults are the run's, and a new node's framing source is what an absent one reads as (its spec)", () => {
    const d = NODE_DEFINITIONS.find((x) => x.type === "speaker-layout")!.defaultData as Record<string, unknown>
    for (const key of ["targetAspect", "layout", "switchType", "emphasisStyle", "reviewBeforeRender"] as const) {
      expect(d[key], key).toEqual(SPEAKER_LAYOUT_DEFAULTS[key])
    }
    expect(d.framingSource).toBe(usecaseDescriptor("speaker-layout").absentFramingSource)
  })

  it("a video producer and a JSON producer (its edit is an EDL), executable, its fee mirror, Nodaro-exclusive, a use-case type", () => {
    expect(VIDEO_PRODUCER_TYPES.has("speaker-layout")).toBe(true)
    expect(JSON_PRODUCER_TYPES.has("speaker-layout")).toBe(true)
    expect(HANDLE_OUTPUT_TYPES["speaker-layout"]).toMatchObject({ json: "look" })
    expect(declaredJsonOutput("speaker-layout", "json")).toBe("edl")
    expect(EXECUTABLE_TYPES.has("speaker-layout")).toBe(true)
    expect(definition.priceRows["use-case-fee:speaker-layout"]).toBe(10)
    expect(NODE_CREDIT_COSTS["use-case-fee:speaker-layout"]).toBe(10)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("speaker-layout")).toBe(true)
    expect(USE_CASE_NODE_TYPES).toContain("speaker-layout")
    expect(usecaseDescriptor("speaker-layout").resultKind).toBe("layout")
  })

  it("connections: two uploads into Recordings, never an image; its video into Add Captions, its edit into JSON Process", () => {
    expect(isValidWorkflowConnection({ source: "cam1", target: "sl", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "cam2", target: "sl", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "sl", sourceHandle: "image", targetHandle: "media" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "sl", target: "cap", sourceHandle: "media", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "sl", target: "jp", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
  })

  it("an Upload Audio into Master audio for a viewer offered Speaker Map; never a video there", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(isValidWorkflowConnection({ source: "mic", target: "sl", sourceHandle: "audio", targetHandle: "masterAudio" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "cam1", target: "sl", sourceHandle: "video", targetHandle: "masterAudio" }, typeOf)).toBe(false)
  })

  it("picker: the Podcast family, right after Clip Pack", () => {
    const types = NODE_FAMILIES.find((f) => f.id === "video-podcast")!.types
    expect(types.indexOf("speaker-layout")).toBe(types.indexOf("clip-pack") + 1)
    expect(NODE_OPTIONS.find((o) => o.type === "speaker-layout")!.group).toBe("video-podcast")
  })

  it("its label reads in every editor language", () => {
    expect(localizeNodeLabel("Speaker Layout", "he")).toBe("פריסת דוברים")
    expect(localizeNodeLabel("Speaker Layout", "ja")).toBe("スピーカーレイアウト")
    expect(localizeNodeLabel("Speaker Layout", "ko")).toBe("화자별 화면 배치")
    expect(localizeNodeLabel("Speaker Layout", "pt-BR")).toBe("Layout de locutores")
  })
})
