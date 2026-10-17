// @test-units-by-name checks only the episode-chapters entries it names
import { describe, it, expect } from "vitest"
import { getOutputType } from "@nodaro/shared/apps"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, declaredJsonOutput } from "@nodaro/shared/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { TEXT_PRODUCER_TYPES } from "@/lib/generate-image-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"
import { TEXT_SOURCE_TYPES } from "@/components/editor/config-panels/helpers"

const typeOf = (id: string) =>
  ({ rec: "upload-video", pod: "upload-audio", c: "episode-chapters", llm: "llm-chat", img: "upload-image", jp: "json-process" } as Record<string, string>)[id]

describe("Chapters is registered everywhere it must be", () => {
  it("definition: media in; text and json out; economy by default", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "episode-chapters")!
    expect(def.inputs).toEqual(["media"])
    expect(def.outputs).toEqual(["text", "json"])
    expect(def.defaultData).toMatchObject({ label: "Chapters", planTier: "economy", instructions: "", styleGuide: "" })
  })

  it("its pips: text and json producers, no media producer, executable, fee mirror, Nodaro-exclusive", () => {
    expect(TEXT_PRODUCER_TYPES.has("episode-chapters")).toBe(true)
    expect(JSON_PRODUCER_TYPES.has("episode-chapters")).toBe(true)
    expect(HANDLE_OUTPUT_TYPES["episode-chapters"]).toEqual({ text: "text", json: "look" })
    expect(VIDEO_PRODUCER_TYPES.has("episode-chapters") || AUDIO_PRODUCER_TYPES.has("episode-chapters") || DYNAMIC_PRODUCER_TYPES.has("episode-chapters")).toBe(false)
    expect(EXECUTABLE_TYPES.has("episode-chapters")).toBe(true)
    expect(NODE_CREDIT_COSTS["use-case-fee:episode-chapters"]).toBe(10)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("episode-chapters")).toBe(true)
  })

  it("a chapter list is neither a Transcript nor an EDL; a published app shows its show notes as text", () => {
    expect(declaredJsonOutput("episode-chapters", "json")).toBe("other")
    expect(getOutputType("episode-chapters")).toBe("text")
    // A prompt field's mapping dropdown offers it when it is wired.
    expect(TEXT_SOURCE_TYPES).toContain("episode-chapters")
  })

  it("connections: a video or audio recording in, never an image; its text into a prompt, its list into JSON Process", () => {
    expect(isValidWorkflowConnection({ source: "rec", target: "c", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "pod", target: "c", sourceHandle: "audio", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "c", sourceHandle: "image", targetHandle: "media" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "c", target: "llm", sourceHandle: "text", targetHandle: "prompt" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "c", target: "jp", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
  })

  it("picker: the Podcast family on the Video tab, and shown on the Audio tab (a recording may be audio only)", () => {
    expect(NODE_FAMILIES.find((f) => f.id === "video-podcast")!.types).toContain("episode-chapters")
    expect(NODE_OPTIONS.find((o) => o.type === "episode-chapters")!.group).toBe("video-podcast")
    expect(TAB_SUPERSET.audio["video-podcast"]).toEqual(["tighten-episode", "episode-chapters"])
  })
})
