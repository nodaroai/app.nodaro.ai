// @test-units-by-name checks only the clip-pack entries it names
import { describe, it, expect } from "vitest"
import { getOutputType } from "@nodaro/shared/apps"
import { DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, declaredJsonOutput, defaultEdgeOutputMode } from "@nodaro/shared/nodes"
import { CLIP_PACK_DEFAULTS, RUN_RESULT_TYPE_KEYS } from "@nodaro/render-rules"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { EXECUTABLE_TYPES, NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { localizeNodeLabel } from "@/lib/i18n/labels"

const typeOf = (id: string) =>
  ({ rec: "upload-video", pod: "upload-audio", cp: "clip-pack", img: "upload-image", smf: "social-media-format", jp: "json-process", ta: "trim-audio" } as Record<string, string>)[id]

describe("Clip Pack is registered everywhere it must be", () => {
  it("definition: the recording in; the clips and the plan out; the run's own defaults", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "clip-pack")!
    expect(def.label).toBe("Clip Pack")
    expect(def.category).toBe("processing")
    expect(def.inputs).toEqual(["media"])
    expect(def.outputs).toEqual(["clips", "json"])
    expect(def.defaultData).toMatchObject({
      label: "Clip Pack",
      count: 8,
      targetDurationSec: 60,
      framing: { aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" },
      captions: true,
      captionStyle: "karaoke",
      reviewBeforeRender: false,
      planTier: "standard",
    })
  })

  it("its defaults are the run's (CLIP_PACK_DEFAULTS), so a fresh node quotes and runs what it shows", () => {
    const d = NODE_DEFINITIONS.find((x) => x.type === "clip-pack")!.defaultData as Record<string, unknown>
    for (const key of ["count", "targetDurationSec", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier"] as const) {
      expect(d[key], key).toEqual(CLIP_PACK_DEFAULTS[key])
    }
  })

  it("its pips: a dynamic producer (clips, video or audio) and a json producer (its plan), executable, fee mirror, Nodaro-exclusive", () => {
    expect(DYNAMIC_PRODUCER_TYPES.has("clip-pack")).toBe(true)
    expect(VIDEO_PRODUCER_TYPES.has("clip-pack")).toBe(false)
    expect(JSON_PRODUCER_TYPES.has("clip-pack")).toBe(true)
    // Its clips pip is runtime-typed (audio for an audio recording), so only the plan is a static pip.
    expect(HANDLE_OUTPUT_TYPES["clip-pack"]).toEqual({ json: "look" })
    expect(EXECUTABLE_TYPES.has("clip-pack")).toBe(true)
    expect(NODE_CREDIT_COSTS["use-case-fee:clip-pack"]).toBe(10)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("clip-pack")).toBe(true)
  })

  it("its clips fan out on an Each wire; its plan is an EDL; a published app shows its clips as video", () => {
    expect(defaultEdgeOutputMode("clip-pack", "clips")).toBe("each")
    expect(defaultEdgeOutputMode("clip-pack", "json")).toBe("last")
    expect(declaredJsonOutput("clip-pack", "json")).toBe("edl")
    expect(getOutputType("clip-pack")).toBe("video")
  })

  it("Clear takes its last run's failure code and the clips it could not render", () => {
    expect(RUN_RESULT_TYPE_KEYS["clip-pack"]).toEqual(["errorCode", "failedClips"])
  })

  it("connections: a video or audio recording in, never an image; its clips into Social Media Format, its plan into JSON Process", () => {
    expect(isValidWorkflowConnection({ source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "pod", target: "cp", sourceHandle: "audio", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "cp", sourceHandle: "image", targetHandle: "media" }, typeOf)).toBe(false)
    expect(isValidWorkflowConnection({ source: "cp", target: "smf", sourceHandle: "clips", targetHandle: "media" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "cp", target: "jp", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
    // Its clips are audio for an audio recording, so an audio-only step takes them too (Trim Audio's `in`).
    expect(isValidWorkflowConnection({ source: "cp", target: "ta", sourceHandle: "clips", targetHandle: "in" }, typeOf)).toBe(true)
    expect(TARGET_HANDLE_ACCEPTS["clip-pack"]?.map((h) => [h.handleId, h.label])).toEqual([["media", "Recording"]])
  })

  it("picker: the Podcast family on the Video tab, and on the Audio tab too (an audio recording makes audio clips)", () => {
    expect(NODE_FAMILIES.find((f) => f.id === "video-podcast")!.types).toContain("clip-pack")
    expect(NODE_OPTIONS.find((o) => o.type === "clip-pack")!.group).toBe("video-podcast")
    expect(TAB_SUPERSET.audio["video-podcast"]).toContain("clip-pack")
  })

  it("its label reads in every editor language", () => {
    expect(localizeNodeLabel("Clip Pack", "he")).toBe("חבילת קליפים")
    expect(localizeNodeLabel("Clip Pack", "ja")).toBe("クリップパック")
    expect(localizeNodeLabel("Clip Pack", "ko")).toBe("클립 세트")
    expect(localizeNodeLabel("Clip Pack", "pt-BR")).toBe("Pacote de clipes")
  })
})
