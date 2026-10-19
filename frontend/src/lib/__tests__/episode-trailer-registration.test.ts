// @test-units-by-name checks only the episode-trailer entries it names
import { describe, it, expect } from "vitest"
import { getOutputType } from "@nodaro/shared/apps"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, declaredJsonOutput } from "@nodaro/shared/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"

const typeOf = (id: string) =>
  ({ rec: "upload-video", pod: "upload-audio", tr: "episode-trailer", img: "upload-image", cv: "combine-videos", jp: "json-process" } as Record<string, string>)[id]

describe("Trailer is registered everywhere it must be", () => {
  it("definition: the recording and an intro card in; the trailers and the plan out; three formats by default", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "episode-trailer")!
    expect(def.label).toBe("Trailer")
    expect(def.inputs).toEqual(["media", "introCard"])
    expect(def.outputs).toEqual(["media", "json"])
    expect(def.defaultData).toMatchObject({ label: "Trailer", formats: ["9:16", "1:1", "4:5"], reviewBeforeRender: false, planTier: "standard" })
  })

  it("its pips: a video producer (its trailers) and a json producer (its plan), executable, fee mirror, Nodaro-exclusive", () => {
    expect(VIDEO_PRODUCER_TYPES.has("episode-trailer")).toBe(true)
    expect(AUDIO_PRODUCER_TYPES.has("episode-trailer") || DYNAMIC_PRODUCER_TYPES.has("episode-trailer")).toBe(false)
    expect(JSON_PRODUCER_TYPES.has("episode-trailer")).toBe(true)
    // Its media pip is always video (an audio-only recording is refused), so it is a static pip.
    expect(HANDLE_OUTPUT_TYPES["episode-trailer"]).toEqual({ json: "look", media: "video" })
    expect(EXECUTABLE_TYPES.has("episode-trailer")).toBe(true)
    expect(NODE_CREDIT_COSTS["use-case-fee:episode-trailer"]).toBe(10)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("episode-trailer")).toBe(true)
  })

  it("its plan is an EDL; a published app shows its trailers as video", () => {
    expect(declaredJsonOutput("episode-trailer", "json")).toBe("edl")
    expect(getOutputType("episode-trailer")).toBe("video")
  })

  it("connections: a video recording and a video intro card in — never audio only, never an image; its trailers into Combine Videos", () => {
    expect(isValidWorkflowConnection({ source: "rec", target: "tr", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "pod", target: "tr", sourceHandle: "audio", targetHandle: "media" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "rec", target: "tr", sourceHandle: "video", targetHandle: "introCard" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "tr", sourceHandle: "image", targetHandle: "introCard" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "tr", target: "cv", sourceHandle: "media", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "tr", target: "jp", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
    expect(TARGET_HANDLE_ACCEPTS["episode-trailer"]?.map((h) => [h.handleId, h.label])).toEqual([["media", "Recording"], ["introCard", "Intro card"]])
  })

  it("picker: the Podcast family on the Video tab, and not on the Audio tab (a trailer is video only)", () => {
    expect(NODE_FAMILIES.find((f) => f.id === "video-podcast")!.types).toContain("episode-trailer")
    expect(NODE_OPTIONS.find((o) => o.type === "episode-trailer")!.group).toBe("video-podcast")
    expect(TAB_SUPERSET.audio["video-podcast"]).not.toContain("episode-trailer")
  })
})
