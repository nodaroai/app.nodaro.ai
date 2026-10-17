import { describe, it, expect } from "vitest"
import { DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { getOutputType } from "@nodaro/shared/apps"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"

const typeOf = (id: string) => ({ rec: "upload-video", bed: "upload-audio", tts: "text-to-speech", t: "tighten-episode", combine: "combine-videos", cap: "add-captions" } as Record<string, string>)[id]

describe("Tighten Episode is registered everywhere it must be", () => {
  it("definition: inputs media+music, outputs media+json, defaults", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "tighten-episode")!
    expect(def.inputs).toEqual(["media", "music"])
    expect(def.outputs).toEqual(["media", "json"])
    expect(def.defaultData).toMatchObject({ label: "Tighten Episode", output: "video", captions: true, reviewBeforeRender: false, planTier: "standard" })
  })
  it("producer sets, json producer, output types, executable, fee mirror", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("tighten-episode")).toBe(true)
    expect(JSON_PRODUCER_TYPES.has("tighten-episode")).toBe(true)
    expect(HANDLE_OUTPUT_TYPES["tighten-episode"]).toEqual({ json: "look" })
    expect(getOutputType("tighten-episode")).toBe("video")
    expect(EXECUTABLE_TYPES.has("tighten-episode")).toBe(true)
    expect(NODE_CREDIT_COSTS["use-case-fee:tighten-episode"]).toBe(10)
  })
  it("a Nodaro-exclusive node (decided 2026-10-13) — hidden from discovery and badged on an unconnected install", () => {
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("tighten-episode")).toBe(true)
  })
  it("connections: a recording into media, audio into music; its media out to a video consumer", () => {
    expect(isValidWorkflowConnection({ source: "rec", target: "t", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "bed", target: "t", sourceHandle: "audio", targetHandle: "music" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "rec", target: "t", sourceHandle: "video", targetHandle: "music" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "t", target: "combine", sourceHandle: "media", targetHandle: "in" }, typeOf)).toBe(true)
  })
})

describe("picker: a Podcast family on the Video tab, shown on the Audio tab too", () => {
  it("one family, owned by the Video tab", () => {
    const fam = NODE_FAMILIES.find((f) => f.id === "video-podcast")!
    expect(fam).toMatchObject({ label: "Podcast", tab: "video" })
    expect(fam.types).toContain("tighten-episode")
    expect(NODE_OPTIONS.find((o) => o.type === "tighten-episode")!.group).toBe("video-podcast")
  })
  it("the Audio tab shows it (an audio episode is a first-class result)", () => {
    expect(TAB_SUPERSET.audio["video-podcast"]).toContain("tighten-episode")
  })
})
