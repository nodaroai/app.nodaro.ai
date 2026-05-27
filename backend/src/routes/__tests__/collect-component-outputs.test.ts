import { describe, it, expect } from "vitest"
import { collectComponentOutputs } from "../_collect-component-outputs.js"
import type { ComponentMetadata } from "@nodaro/shared"

const meta = (outputs: ComponentMetadata["outputs"]): ComponentMetadata => ({
  inputs: [],
  outputs,
  exposedSettings: [],
})

describe("collectComponentOutputs", () => {
  it("reads a plain handle directly from nodeStates[nodeId].output[fieldKey]", () => {
    const out = collectComponentOutputs(
      meta([{ id: "n1", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }]),
      { n1: { output: { imageUrl: "https://cdn/x.png" } } },
      [{ id: "n1", type: "generate-image" }],
      [],
    )
    expect(out).toEqual({ n1: "https://cdn/x.png" })
  })

  it("falls back to OUTPUT_FIELD_MAP[type] when handle.fieldKey is empty", () => {
    const out = collectComponentOutputs(
      meta([{ id: "n1", name: "Result", type: "video", required: true, mediaPreview: true, fieldKey: "" }]),
      { n1: { output: { videoUrl: "https://cdn/v.mp4" } } },
      [],
      [],
    )
    expect(out).toEqual({ n1: "https://cdn/v.mp4" })
  })

  it("compound handle resolves via snapshot edge into the port", () => {
    // Topology: generate-image n_gen  →  sub-workflow-output out1 (port pZ)
    const out = collectComponentOutputs(
      meta([{ id: "out1::pZ", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "pZ" }]),
      { n_gen: { output: { imageUrl: "https://cdn/img.png" } } },
      [
        { id: "n_gen", type: "generate-image" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [{ source: "n_gen", target: "out1", sourceHandle: "image", targetHandle: "pZ" }],
    )
    expect(out).toEqual({ "out1::pZ": "https://cdn/img.png" })
  })

  it("multi-port sub-workflow-output: each port resolves to its own upstream value", () => {
    const out = collectComponentOutputs(
      meta([
        { id: "out1::pImg", name: "Image", type: "image", required: true, mediaPreview: true, fieldKey: "pImg" },
        { id: "out1::pTxt", name: "Caption", type: "text", required: true, mediaPreview: false, fieldKey: "pTxt" },
      ]),
      {
        nImg: { output: { imageUrl: "https://cdn/i.png" } },
        nTxt: { output: { text: "hello world" } },
      },
      [
        { id: "nImg", type: "generate-image" },
        { id: "nTxt", type: "ai-writer" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [
        { source: "nImg", target: "out1", sourceHandle: "image", targetHandle: "pImg" },
        { source: "nTxt", target: "out1", sourceHandle: "text", targetHandle: "pTxt" },
      ],
    )
    expect(out).toEqual({
      "out1::pImg": "https://cdn/i.png",
      "out1::pTxt": "hello world",
    })
  })

  it("compound handle with no matching edge is skipped (no entry in outputs)", () => {
    const out = collectComponentOutputs(
      meta([{ id: "out1::pZ", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "pZ" }]),
      { n_gen: { output: { imageUrl: "https://cdn/img.png" } } },
      [
        { id: "n_gen", type: "generate-image" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [], // no edge → no value resolved
    )
    expect(out).toEqual({})
  })

  it("compound handle with edge but missing upstream nodeState is skipped", () => {
    const out = collectComponentOutputs(
      meta([{ id: "out1::pZ", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "pZ" }]),
      {}, // no nodeStates
      [
        { id: "n_gen", type: "generate-image" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [{ source: "n_gen", target: "out1", sourceHandle: "image", targetHandle: "pZ" }],
    )
    expect(out).toEqual({})
  })

  it("non-string output values are dropped (only string media URLs survive)", () => {
    const out = collectComponentOutputs(
      meta([{ id: "n1", name: "Result", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }]),
      { n1: { output: { imageUrl: 42 } } },
      [],
      [],
    )
    expect(out).toEqual({})
  })

  it("mixed plain + compound handles in the same metadata", () => {
    const out = collectComponentOutputs(
      meta([
        { id: "n_plain", name: "Plain", type: "text", required: true, mediaPreview: true, fieldKey: "text" },
        { id: "out1::pZ", name: "Port", type: "video", required: true, mediaPreview: false, fieldKey: "pZ" },
      ]),
      {
        n_plain: { output: { text: "plain-value" } },
        n_src: { output: { videoUrl: "https://cdn/v.mp4" } },
      },
      [
        { id: "n_plain", type: "ai-writer" },
        { id: "n_src", type: "image-to-video" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [{ source: "n_src", target: "out1", sourceHandle: "video", targetHandle: "pZ" }],
    )
    expect(out).toEqual({
      n_plain: "plain-value",
      "out1::pZ": "https://cdn/v.mp4",
    })
  })

  it("compound handle resolves from generate-video upstream (unified video node parity)", () => {
    // The unified generate-video node lives in VIDEO_PRODUCER_TYPES, so
    // `getPrimaryOutput(srcOutput, "generate-video", "video")` MUST return
    // the videoUrl. Without that, components that wrap a generate-video
    // node and expose its output port would silently return undefined and
    // any downstream consumer would receive an empty value.
    const out = collectComponentOutputs(
      meta([{ id: "out1::pVid", name: "Result", type: "video", required: true, mediaPreview: true, fieldKey: "pVid" }]),
      { n_gen: { output: { videoUrl: "https://cdn/gv.mp4" } } },
      [
        { id: "n_gen", type: "generate-video" },
        { id: "out1", type: "sub-workflow-output" },
      ],
      [{ source: "n_gen", target: "out1", sourceHandle: "video", targetHandle: "pVid" }],
    )
    expect(out).toEqual({ "out1::pVid": "https://cdn/gv.mp4" })
  })

  it("plain handle reads videoUrl directly from generate-video output", () => {
    // Plain-handle path: fieldKey="" falls through to OUTPUT_FIELD_MAP[type]
    // (which maps "video" -> "videoUrl"). Confirms component metadata that
    // points straight at a generate-video node (no sub-workflow-output
    // indirection) still extracts the URL.
    const out = collectComponentOutputs(
      meta([{ id: "n_gen", name: "Result", type: "video", required: true, mediaPreview: true, fieldKey: "" }]),
      { n_gen: { output: { videoUrl: "https://cdn/gv.mp4" } } },
      [{ id: "n_gen", type: "generate-video" }],
      [],
    )
    expect(out).toEqual({ n_gen: "https://cdn/gv.mp4" })
  })
})
