import { describe, it, expect, vi } from "vitest"
import { selectListItems } from "@nodaro-shared/edge-range"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveNodeInputs, resolveLoopColumnValues, resolveEdgeValuesForTableColumn } from "../node-input-resolver"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string): any {
  return { id: `${source}->${target}`, source, target }
}

// ---------------------------------------------------------------------------
// resolveNodeInputs
// ---------------------------------------------------------------------------

describe("resolveNodeInputs", () => {
  it("resolves text-prompt source as prompt input", () => {
    const textNode = makeNode("t1", "text-prompt", { text: "hello" })
    const target = makeNode("t2", "generate-image")
    const edges = [makeEdge("t1", "t2")]

    const inputs = resolveNodeInputs(target, [textNode, target], edges)
    expect(inputs.prompt).toBe("hello")
  })

  it("resolves upload-image as referenceImageUrls for generate-image target", () => {
    const uploadNode = makeNode("u1", "upload-image", { url: "http://img.png" })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(target, [uploadNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://img.png")
  })

  it("resolves upload-image as imageUrl for image-to-video target", () => {
    const uploadNode = makeNode("u1", "upload-image", { url: "http://img.png" })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(target, [uploadNode, target], edges)
    expect(inputs.imageUrl).toBe("http://img.png")
  })

  it("resolves character node as referenceImageUrls", () => {
    const charNode = makeNode("c1", "character", {
      sourceImageUrl: "http://char.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("c1", "t1")]

    const inputs = resolveNodeInputs(target, [charNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://char.png")
  })

  it("resolves face node as referenceImageUrls", () => {
    const faceNode = makeNode("f1", "face", {
      sourceImageUrl: "http://face.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("f1", "t1")]

    const inputs = resolveNodeInputs(target, [faceNode, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://face.png")
  })

  it("resolves multiple upload-video sources into videoUrls for combine-videos", () => {
    const vid1 = makeNode("v1", "upload-video", { url: "http://v1.mp4" })
    const vid2 = makeNode("v2", "upload-video", { url: "http://v2.mp4" })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("v1", "t1"), makeEdge("v2", "t1")]

    const inputs = resolveNodeInputs(target, [vid1, vid2, target], edges)
    expect(inputs.videoUrls).toContain("http://v1.mp4")
    expect(inputs.videoUrls).toContain("http://v2.mp4")
    expect(inputs.videoUrls).toHaveLength(2)
  })

  it("resolves upload-video as videoUrl for non-combine targets", () => {
    const vid = makeNode("v1", "upload-video", { url: "http://v1.mp4" })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("v1", "t1")]

    const inputs = resolveNodeInputs(target, [vid, target], edges)
    expect(inputs.videoUrl).toBe("http://v1.mp4")
  })

  it("resolves text-to-speech as audioSources for merge-video-audio", () => {
    const ttsNode = makeNode("tts", "text-to-speech", {
      generatedResults: [
        { url: "http://audio.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("tts", "t1")]

    const inputs = resolveNodeInputs(target, [ttsNode, target], edges)
    expect(inputs.audioSources).toBeDefined()
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://audio.mp3")
  })

  it("accumulates multiple audio sources into audioUrls for mix-audio", () => {
    const audio1 = makeNode("a1", "text-to-speech", {
      generatedResults: [
        { url: "http://audio1.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const audio2 = makeNode("a2", "upload-audio", {
      r2Url: "http://audio2.mp3",
    })
    const target = makeNode("t1", "mix-audio")
    const edges = [makeEdge("a1", "t1"), makeEdge("a2", "t1")]

    const inputs = resolveNodeInputs(
      target,
      [audio1, audio2, target],
      edges,
    )
    expect(inputs.audioUrls).toBeDefined()
    expect(inputs.audioUrls).toContain("http://audio1.mp3")
    expect(inputs.audioUrls).toContain("http://audio2.mp3")
    expect(inputs.audioUrls).toHaveLength(2)
  })

  it("resolves generate-image as imageUrl for image-to-video target", () => {
    const genImage = makeNode("g1", "generate-image", {
      generatedResults: [
        { url: "http://gen.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [makeEdge("g1", "t1")]

    const inputs = resolveNodeInputs(target, [genImage, target], edges)
    expect(inputs.imageUrl).toBe("http://gen.png")
  })

  it("resolves generate-image as referenceImageUrls for another generate-image", () => {
    const genImage = makeNode("g1", "generate-image", {
      generatedResults: [
        { url: "http://gen.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("g1", "t1")]

    const inputs = resolveNodeInputs(target, [genImage, target], edges)
    expect(inputs.referenceImageUrls).toContain("http://gen.png")
  })

  it("resolves image-to-video as videoUrl for merge-video-audio", () => {
    const i2v = makeNode("iv1", "image-to-video", {
      generatedResults: [
        { url: "http://video.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("iv1", "t1")]

    const inputs = resolveNodeInputs(target, [i2v, target], edges)
    expect(inputs.videoUrl).toBe("http://video.mp4")
  })

  it("resolves ai-writer output as prompt", () => {
    const writer = makeNode("w1", "ai-writer", {
      generatedText: "A dramatic story",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("w1", "t1")]

    const inputs = resolveNodeInputs(target, [writer, target], edges)
    expect(inputs.prompt).toBe("A dramatic story")
  })

  it("resolves transcribe output as prompt", () => {
    const transcribe = makeNode("tr1", "transcribe", {
      generatedResults: [{ text: "transcribed text" }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "text-to-speech")
    const edges = [makeEdge("tr1", "t1")]

    const inputs = resolveNodeInputs(target, [transcribe, target], edges)
    expect(inputs.prompt).toBe("transcribed text")
  })

  it("resolves combine-text output as prompt", () => {
    const combineText = makeNode("ct1", "combine-text", {
      combinedText: "combined output text",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("ct1", "t1")]

    const inputs = resolveNodeInputs(target, [combineText, target], edges)
    expect(inputs.prompt).toBe("combined output text")
  })

  it("skips source nodes with no output", () => {
    // text-prompt with no text set -> extractNodeOutput returns undefined (or empty)
    const textNode = makeNode("t1", "text-prompt", {})
    const target = makeNode("t2", "generate-image")
    const edges = [makeEdge("t1", "t2")]

    const inputs = resolveNodeInputs(target, [textNode, target], edges)
    // undefined text means extractNodeOutput returns undefined, source skipped
    expect(inputs.prompt).toBeUndefined()
  })

  it("resolves upload-audio as audioSources for merge-video-audio", () => {
    const audioNode = makeNode("a1", "upload-audio", {
      r2Url: "http://uploaded-audio.mp3",
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [makeEdge("a1", "t1")]

    const inputs = resolveNodeInputs(target, [audioNode, target], edges)
    expect(inputs.audioSources).toBeDefined()
    expect(inputs.audioSources).toHaveLength(1)
    expect(inputs.audioSources![0].url).toBe("http://uploaded-audio.mp3")
  })

  it("resolves multiple image sources as accumulated referenceImageUrls", () => {
    const char = makeNode("c1", "character", {
      sourceImageUrl: "http://char.png",
    })
    const upload = makeNode("u1", "upload-image", {
      url: "http://upload.png",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("c1", "t1"), makeEdge("u1", "t1")]

    const inputs = resolveNodeInputs(
      target,
      [char, upload, target],
      edges,
    )
    expect(inputs.referenceImageUrls).toContain("http://char.png")
    expect(inputs.referenceImageUrls).toContain("http://upload.png")
    expect(inputs.referenceImageUrls).toHaveLength(2)
  })

  it("resolves video-type sources into videoUrls for combine-videos", () => {
    const i2v = makeNode("iv1", "image-to-video", {
      generatedResults: [
        { url: "http://v1.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const t2v = makeNode("tv1", "text-to-video", {
      generatedResults: [
        { url: "http://v2.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "combine-videos")
    const edges = [makeEdge("iv1", "t1"), makeEdge("tv1", "t1")]

    const inputs = resolveNodeInputs(target, [i2v, t2v, target], edges)
    expect(inputs.videoUrls).toContain("http://v1.mp4")
    expect(inputs.videoUrls).toContain("http://v2.mp4")
    expect(inputs.videoUrls).toHaveLength(2)
  })

  it("resolves list node output as prompt", () => {
    const listNode = makeNode("l1", "list", {
      items: "first item\nsecond item",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("l1", "t1")]

    const inputs = resolveNodeInputs(target, [listNode, target], edges)
    expect(inputs.prompt).toBe("first item")
  })

  // sub-workflow output routing tests
  it("resolves sub-workflow image output as imageUrl", () => {
    const swNode = makeNode("sw1", "sub-workflow", {
      outputResults: { imgPort: "http://result.png" },
      routeSnapshot: {
        outputPorts: [{ id: "imgPort", mediaType: "image" }],
        visibleOutputPortId: "imgPort",
      },
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [{ id: "sw1->t1", source: "sw1", target: "t1", sourceHandle: "out_imgPort" }]

    const inputs = resolveNodeInputs(target, [swNode, target], edges)
    expect(inputs.imageUrl).toBe("http://result.png")
  })

  it("resolves sub-workflow video output as videoUrl", () => {
    const swNode = makeNode("sw1", "sub-workflow", {
      outputResults: { vidPort: "http://result.mp4" },
      routeSnapshot: {
        outputPorts: [{ id: "vidPort", mediaType: "video" }],
        visibleOutputPortId: "vidPort",
      },
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [{ id: "sw1->t1", source: "sw1", target: "t1", sourceHandle: "out_vidPort" }]

    const inputs = resolveNodeInputs(target, [swNode, target], edges)
    expect(inputs.videoUrl).toBe("http://result.mp4")
  })

  it("resolves sub-workflow audio output as audioUrl", () => {
    const swNode = makeNode("sw1", "sub-workflow", {
      outputResults: { audPort: "http://result.mp3" },
      routeSnapshot: {
        outputPorts: [{ id: "audPort", mediaType: "audio" }],
        visibleOutputPortId: "audPort",
      },
    })
    const target = makeNode("t1", "merge-video-audio")
    const edges = [{ id: "sw1->t1", source: "sw1", target: "t1", sourceHandle: "out_audPort" }]

    const inputs = resolveNodeInputs(target, [swNode, target], edges)
    // merge-video-audio routes audio to audioSources, not audioUrl
    expect(inputs.audioSources).toEqual([
      { url: "http://result.mp3", sourceNodeId: "sw1" },
    ])
  })

  it("resolves sub-workflow text output as prompt", () => {
    const swNode = makeNode("sw1", "sub-workflow", {
      outputResults: { txtPort: "generated prompt text" },
      routeSnapshot: {
        outputPorts: [{ id: "txtPort", mediaType: "text" }],
        visibleOutputPortId: "txtPort",
      },
    })
    const target = makeNode("t1", "generate-image")
    const edges = [{ id: "sw1->t1", source: "sw1", target: "t1", sourceHandle: "out_txtPort" }]

    const inputs = resolveNodeInputs(target, [swNode, target], edges)
    expect(inputs.prompt).toBe("generated prompt text")
  })

  it("resolves sub-workflow-input injected value routing by mediaType", () => {
    const inputNode = makeNode("swi1", "sub-workflow-input", {
      __injectedPortValues: { p1: "http://injected-image.png" },
      ports: [{ id: "p1", name: "Image", mediaType: "image" }],
    })
    const target = makeNode("t1", "image-to-video")
    const edges = [{ id: "swi1->t1", source: "swi1", target: "t1", sourceHandle: "p1" }]

    const inputs = resolveNodeInputs(target, [inputNode, target], edges)
    expect(inputs.imageUrl).toBe("http://injected-image.png")
  })

  it("resolves image, audio, and text inputs for speech-to-video", () => {
    const imgNode = makeNode("u1", "upload-image", { url: "http://portrait.png" })
    const audioNode = makeNode("a1", "upload-audio", { r2Url: "http://voice.mp3" })
    const textNode = makeNode("t1", "text-prompt", { text: "A person speaking" })
    const target = makeNode("s2v", "speech-to-video")
    const edges = [
      makeEdge("u1", "s2v"),
      makeEdge("a1", "s2v"),
      makeEdge("t1", "s2v"),
    ]

    const inputs = resolveNodeInputs(
      target,
      [imgNode, audioNode, textNode, target],
      edges,
    )
    expect(inputs.imageUrl).toBe("http://portrait.png")
    expect(inputs.audioUrl).toBe("http://voice.mp3")
    expect(inputs.prompt).toBe("A person speaking")
  })

  it("resolves audio input for suno-mashup", () => {
    // suno-mashup uses routeSunoMashupAudio which fills audioUrl then audioUrl2
    const audio1 = makeNode("a1", "upload-audio", {
      r2Url: "http://audio1.mp3",
    })
    const target = makeNode("m1", "suno-mashup")
    const edges = [makeEdge("a1", "m1")]

    const inputs = resolveNodeInputs(
      target,
      [audio1, target],
      edges,
    )
    expect(inputs.audioUrl).toBe("http://audio1.mp3")
  })

  it("resolves suno-style-boost output as prompt (text)", () => {
    const styleBoost = makeNode("sb1", "suno-style-boost", {
      generatedText: "boosted style text",
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("sb1", "t1")]

    const inputs = resolveNodeInputs(target, [styleBoost, target], edges)
    expect(inputs.prompt).toBe("boosted style text")
  })
})

describe("selectListItems filtering", () => {
  it("range filters the source list", () => {
    const items = ["a", "b", "c", "d", "e"]
    const edgeData = { rangeFrom: "2", rangeTo: "last-1" }
    expect(selectListItems(items, edgeData)).toEqual(["b", "c", "d"])
  })

  it("list filters via list expression", () => {
    const items = ["a", "b", "c", "d", "e"]
    const edgeData = { selectorMode: "list" as const, listExpression: "1, last" }
    expect(selectListItems(items, edgeData)).toEqual(["a", "e"])
  })

  it("default config passes full list", () => {
    const items = ["a", "b", "c"]
    expect(selectListItems(items, {})).toEqual(items)
  })

  it("step is honored", () => {
    const items = ["a", "b", "c", "d", "e"]
    expect(selectListItems(items, { rangeStep: 2 })).toEqual(["a", "c", "e"])
    expect(selectListItems(items, { rangeFrom: "last", rangeTo: "1", rangeStep: -1 }))
      .toEqual(["e", "d", "c", "b", "a"])
  })
})

describe("each-mode per-iteration resolution — list/range filter applied", () => {
  it("list mode filters per-iteration items from non-loop source", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [
        { url: "http://img/1.png" },
        { url: "http://img/2.png" },
        { url: "http://img/3.png" },
        { url: "http://img/4.png" },
        { url: "http://img/5.png" },
      ],
    })
    const target = makeNode("t1", "generate-image")
    const edge = {
      id: "img1->t1",
      source: "img1",
      target: "t1",
      data: {
        outputMode: "each",
        useAllResults: true,
        selectorMode: "list",
        listExpression: "1, 3",
      },
    }

    const iter0 = resolveNodeInputs(target, [imgNode, target], [edge] as any, 0)
    const iter1 = resolveNodeInputs(target, [imgNode, target], [edge] as any, 1)

    expect(iter0.referenceImageUrls).toContain("http://img/1.png")
    expect(iter1.referenceImageUrls).toContain("http://img/3.png")
  })

  it("range mode with step filters per-iteration items from non-loop source", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [
        { url: "http://img/1.png" },
        { url: "http://img/2.png" },
        { url: "http://img/3.png" },
        { url: "http://img/4.png" },
        { url: "http://img/5.png" },
      ],
    })
    const target = makeNode("t1", "generate-image")
    const edge = {
      id: "img1->t1",
      source: "img1",
      target: "t1",
      data: {
        outputMode: "each",
        useAllResults: true,
        rangeStep: 2,
      },
    }

    const iter0 = resolveNodeInputs(target, [imgNode, target], [edge] as any, 0)
    const iter1 = resolveNodeInputs(target, [imgNode, target], [edge] as any, 1)
    const iter2 = resolveNodeInputs(target, [imgNode, target], [edge] as any, 2)

    expect(iter0.referenceImageUrls).toContain("http://img/1.png")
    expect(iter1.referenceImageUrls).toContain("http://img/3.png")
    expect(iter2.referenceImageUrls).toContain("http://img/5.png")
  })
})

describe("resolveLoopColumnValues — upstream edge filter applies", () => {
  it("range filter on upstream edge limits items flowing into loop column", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [
        { url: "u1" }, { url: "u2" }, { url: "u3" }, { url: "u4" },
        { url: "u5" }, { url: "u6" }, { url: "u7" }, { url: "u8" },
        { url: "u9" }, { url: "u10" }, { url: "u11" }, { url: "u12" },
      ],
    })
    const loopNode = makeNode("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const edges = [{
      id: "img1->loop1",
      source: "img1",
      target: "loop1",
      targetHandle: "col_c1_in",
      sourceHandle: null,
      data: { outputMode: "all", useAllResults: true, rangeFrom: "1", rangeTo: "3" },
    }]

    const values = resolveLoopColumnValues(
      { id: "loop1", data: loopNode.data },
      "col_c1",
      edges as any,
      [imgNode, loopNode] as any,
    )

    expect(values).toEqual(["u1", "u2", "u3"])
  })

  it("chained filters compose via legacy 'in' handle: source → list₁(all 3..6) → list₂(all 1..2)", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: Array.from({ length: 12 }, (_, i) => ({ url: `u${i + 1}` })),
    })
    const list1 = makeNode("list1", "list", { items: "" })
    const list2 = makeNode("list2", "list", { items: "" })
    const edges = [
      {
        id: "img1->list1",
        source: "img1",
        target: "list1",
        sourceHandle: null,
        targetHandle: "in",
        data: { outputMode: "all", useAllResults: true, rangeFrom: "3", rangeTo: "6" },
      },
      {
        id: "list1->list2",
        source: "list1",
        target: "list2",
        sourceHandle: "list",
        targetHandle: "in",
        data: { outputMode: "all", rangeFrom: "1", rangeTo: "2" },
      },
    ]

    const values = resolveLoopColumnValues(
      { id: "list2", data: list2.data },
      undefined,
      edges as any,
      [imgNode, list1, list2] as any,
    )

    expect(values).toEqual(["u3", "u4"])
  })

  it("chained filters compose: source → list₁(all 3..6) → list₂(all 1..2) yields 2 items", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: Array.from({ length: 12 }, (_, i) => ({ url: `u${i + 1}` })),
    })
    const list1 = makeNode("list1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const list2 = makeNode("list2", "list", {
      columns: [{ id: "c2", handleId: "col_c2", type: "image-url" }],
      rows: [],
    })
    const edges = [
      {
        id: "img1->list1",
        source: "img1",
        target: "list1",
        sourceHandle: null,
        targetHandle: "col_c1_in",
        data: { outputMode: "all", useAllResults: true, rangeFrom: "3", rangeTo: "6" },
      },
      {
        id: "list1->list2",
        source: "list1",
        target: "list2",
        sourceHandle: "col_c1",
        targetHandle: "col_c2_in",
        data: { outputMode: "all", rangeFrom: "1", rangeTo: "2" },
      },
    ]

    const values = resolveLoopColumnValues(
      { id: "list2", data: list2.data },
      "col_c2",
      edges as any,
      [imgNode, list1, list2] as any,
    )

    expect(values).toEqual(["u3", "u4"])
  })

  it("triple chain: source → loop₁(all 2..8) → loop₂(all 1..5) → loop₃(all 1..2) yields items 2,3", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: Array.from({ length: 12 }, (_, i) => ({ url: `u${i + 1}` })),
    })
    const loop1 = makeNode("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const loop2 = makeNode("loop2", "loop", {
      columns: [{ id: "c2", handleId: "col_c2", type: "image-url" }],
      rows: [],
    })
    const loop3 = makeNode("loop3", "loop", {
      columns: [{ id: "c3", handleId: "col_c3", type: "image-url" }],
      rows: [],
    })
    const edges = [
      {
        id: "img1->loop1",
        source: "img1",
        target: "loop1",
        sourceHandle: null,
        targetHandle: "col_c1_in",
        data: { outputMode: "all", useAllResults: true, rangeFrom: "2", rangeTo: "8" },
      },
      {
        id: "loop1->loop2",
        source: "loop1",
        target: "loop2",
        sourceHandle: "col_c1",
        targetHandle: "col_c2_in",
        data: { outputMode: "all", rangeFrom: "1", rangeTo: "5" },
      },
      {
        id: "loop2->loop3",
        source: "loop2",
        target: "loop3",
        sourceHandle: "col_c2",
        targetHandle: "col_c3_in",
        data: { outputMode: "all", rangeFrom: "1", rangeTo: "2" },
      },
    ]

    const values = resolveLoopColumnValues(
      { id: "loop3", data: loop3.data },
      "col_c3",
      edges as any,
      [imgNode, loop1, loop2, loop3] as any,
    )

    // Expected flow:
    //   source[1..12] → loop1 filter 2..8 → [u2, u3, u4, u5, u6, u7, u8] (7 items)
    //   loop1[1..7] → loop2 filter 1..5 → [u2, u3, u4, u5, u6] (5 items)
    //   loop2[1..5] → loop3 filter 1..2 → [u2, u3]
    expect(values).toEqual(["u2", "u3"])
  })

  it("list-expression filter on upstream edge limits items flowing into loop column", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: [
        { url: "u1" }, { url: "u2" }, { url: "u3" }, { url: "u4" }, { url: "u5" },
      ],
    })
    const loopNode = makeNode("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const edges = [{
      id: "img1->loop1",
      source: "img1",
      target: "loop1",
      targetHandle: "col_c1_in",
      sourceHandle: null,
      data: {
        outputMode: "all",
        useAllResults: true,
        selectorMode: "list",
        listExpression: "1, 3, last",
      },
    }]

    const values = resolveLoopColumnValues(
      { id: "loop1", data: loopNode.data },
      "col_c1",
      edges as any,
      [imgNode, loopNode] as any,
    )

    expect(values).toEqual(["u1", "u3", "u5"])
  })
})

describe("resolveEdgeValuesForTableColumn (UI display helper)", () => {
  it("honors list selector in all mode (regression: used to use applyRange which dropped list mode)", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: Array.from({ length: 6 }, (_, i) => ({ url: `u${i + 1}` })),
    })
    const edge = {
      source: "img1",
      target: "loop1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: {
        outputMode: "all",
        useAllResults: true,
        selectorMode: "list",
        listExpression: "1, 3, last",
      },
    }
    const vals = resolveEdgeValuesForTableColumn(edge as any, imgNode as any, [edge] as any, [imgNode] as any, undefined)
    expect(vals).toEqual(["u1", "u3", "u6"])
  })

  it("chained tables: UI display sees upstream table's filtered values", () => {
    const imgNode = makeNode("img1", "generate-image", {
      generatedResults: Array.from({ length: 12 }, (_, i) => ({ url: `u${i + 1}` })),
    })
    const loop1 = makeNode("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_c1", type: "image-url" }],
      rows: [],
    })
    const loop2 = makeNode("loop2", "loop", {
      columns: [{ id: "c2", handleId: "col_c2", type: "image-url" }],
      rows: [],
    })
    const edges = [
      {
        source: "img1",
        target: "loop1",
        sourceHandle: null,
        targetHandle: "col_c1_in",
        data: { outputMode: "all", useAllResults: true, rangeFrom: "3", rangeTo: "6" },
      },
      {
        source: "loop1",
        target: "loop2",
        sourceHandle: "col_c1",
        targetHandle: "col_c2_in",
        data: { outputMode: "all", rangeFrom: "1", rangeTo: "2" },
      },
    ]

    const vals = resolveEdgeValuesForTableColumn(
      edges[1] as any,
      loop1 as any,
      edges as any,
      [imgNode, loop1, loop2] as any,
      [{ id: "c2", handleId: "col_c2", type: "image-url" }],
    )

    // source[1..12] → loop1 filter 3..6 → [u3, u4, u5, u6]
    // loop1[1..4] → UI edge filter 1..2 → [u3, u4]
    expect(vals).toEqual(["u3", "u4"])
  })
})
