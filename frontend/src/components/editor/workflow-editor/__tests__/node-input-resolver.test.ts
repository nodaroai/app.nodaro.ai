import { describe, it, expect, vi } from "vitest"
import { selectListItems } from "@nodaro/shared"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveNodeInputs, resolveEdgeValuesForTableColumn, extractNodeOutputAsList } from "../node-input-resolver"
import type { WorkflowNode } from "@/types/nodes"

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

  it("resolves location node sourceImageUrl into referenceImageUrls (no field mapping)", () => {
    const locNode = makeNode("loc1", "location", {
      sourceImageUrl: "http://loc-main.png",
      lighting: [{ name: "noon", url: "http://noon.png" }],
    })
    const target = makeNode("t1", "generate-image")
    const edges = [makeEdge("loc1", "t1")]

    const inputs = resolveNodeInputs(target, [locNode, target], edges)
    expect(inputs.referenceImageUrls).toEqual(["http://loc-main.png"])
  })

  it("resolves location node bucket[idx] field mapping into referenceImageUrls", () => {
    const locNode = makeNode("loc1", "location", {
      sourceImageUrl: "http://loc-main.png",
      lighting: [
        { name: "noon", url: "http://noon.png" },
        { name: "dusk", url: "http://dusk.png" },
      ],
    })
    const target = makeNode("t1", "generate-image", {
      fieldMappings: { locationRef: "lighting[1]" },
    })
    const edges = [makeEdge("loc1", "t1")]

    const inputs = resolveNodeInputs(target, [locNode, target], edges)
    expect(inputs.referenceImageUrls).toEqual(["http://dusk.png"])
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

  it("text mode: extract-field → llm-chat passes the full joined string", () => {
    const extractField = makeNode("ef1", "extract-field", {
      outputType: "text",
      extractedText: "line one\nline two\nline three",
    })
    const target = makeNode("t1", "llm-chat")
    const edges = [{ id: "ef1->t1", source: "ef1", target: "t1", sourceHandle: "text", targetHandle: "prompt" }]

    const inputs = resolveNodeInputs(target, [extractField, target], edges)
    expect(inputs.prompt).toBe("line one\nline two\nline three")
  })

  it("list mode: extract-field → llm-chat with item:1 picks the first item", () => {
    const extractField = makeNode("ef1", "extract-field", {
      outputType: "list",
      extractedText: "item one\nitem two",
      __listResults: ["item one", "item two"],
    })
    const target = makeNode("t1", "llm-chat")
    const edges = [{
      id: "ef1->t1", source: "ef1", target: "t1",
      sourceHandle: "text", targetHandle: "prompt",
      data: { outputMode: "item", itemIndex: "1" },
    }]

    const inputs = resolveNodeInputs(target, [extractField, target], edges)
    expect(inputs.prompt).toBe("item one")
  })

  it("list mode with single item: extract-field → list → llm-chat item:1 keeps the multi-line value intact", () => {
    const extractField = makeNode("ef1", "extract-field", {
      outputType: "list",
      extractedText: "line one\nline two\nline three",
      __listResults: ["line one\nline two\nline three"],
    })
    const listNode = makeNode("list1", "list", {
      rows: [[""]],
      columns: [{ id: "default", handleId: "col_default", type: "text", name: "Extract Field" }],
    })
    const target = makeNode("t1", "llm-chat")
    const edges = [
      {
        id: "ef1->list1", source: "ef1", target: "list1",
        sourceHandle: "text", targetHandle: "col_default_in",
      },
      {
        id: "list1->t1", source: "list1", target: "t1",
        sourceHandle: "col_default", targetHandle: "prompt",
        data: { outputMode: "item", itemIndex: "1" },
      },
    ]

    const inputs = resolveNodeInputs(target, [extractField, listNode, target], edges)
    expect(inputs.prompt).toBe("line one\nline two\nline three")
  })

  it("text mode: extract-field → list → llm-chat item:1 splits on the list column delimiter", () => {
    const extractField = makeNode("ef1", "extract-field", {
      outputType: "text",
      extractedText: "line one\nline two\nline three",
    })
    const listNode = makeNode("list1", "list", {
      rows: [[""]],
      columns: [{ id: "default", handleId: "col_default", type: "text", name: "Extract Field" }],
    })
    const target = makeNode("t1", "llm-chat")
    const edges = [
      {
        id: "ef1->list1", source: "ef1", target: "list1",
        sourceHandle: "text", targetHandle: "col_default_in",
      },
      {
        id: "list1->t1", source: "list1", target: "t1",
        sourceHandle: "col_default", targetHandle: "prompt",
        data: { outputMode: "item", itemIndex: "1" },
      },
    ]

    const inputs = resolveNodeInputs(target, [extractField, listNode, target], edges)
    expect(inputs.prompt).toBe("line one")
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

describe("extractNodeOutputAsList", () => {
  it("extractNodeOutputAsList returns single-item generatedResults (no 2+ guard)", () => {
    const node = {
      id: "n1",
      type: "generate-image",
      data: {
        generatedResults: [{ url: "https://cdn/img1.png" }],
      },
    } as unknown as WorkflowNode
    const result = extractNodeOutputAsList(node)
    expect(result).toEqual(["https://cdn/img1.png"])
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

describe("resolveEdgeValuesForTableColumn (UI display helper)", () => {
  it("split-text upstream is treated as already-structured — items are NOT re-split by target's delimiter", () => {
    // Regression: split-text's custom-delimiter output (e.g. 13 pieces split
    // by "---") used to be re-chopped by the target list's column delimiter
    // (default newline), producing wrong item counts downstream.
    const splitNode = makeNode("split1", "split-text", {
      splitResults: ["piece one\nhas newline", "piece two", "piece three"],
    })
    const edge = {
      source: "split1",
      target: "list1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: { outputMode: "each" },
    }
    const columns = [{ id: "c1", handleId: "col_c1", type: "text" as const }]
    const vals = resolveEdgeValuesForTableColumn(
      edge as any,
      splitNode as any,
      [edge] as any,
      [splitNode] as any,
      columns,
    )
    expect(vals).toEqual([
      "piece one\nhas newline",
      "piece two",
      "piece three",
    ])
  })

  // ---------------------------------------------------------------------------
  // Regression: Bundle worked, Selected/Item didn't — single value picked from
  // upstream wasn't being run through the list column's delimiter.
  // ---------------------------------------------------------------------------
  it("LLM upstream + Selected mode → splits picked value by list's delimiter", () => {
    // The "selected" result from an LLM is one big multi-line string. The list
    // should still split it on its configured delimiter (here: ",").
    const llm = makeNode("llm1", "llm-chat", {
      generatedText: "alpha,bravo,charlie",
    })
    const edge = {
      source: "llm1",
      target: "list1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: { outputMode: "last" }, // "last" = "Selected" in the UI
    }
    const columns = [{ id: "c1", handleId: "col_c1", type: "text" as const, splitDelimiter: "," }]
    const vals = resolveEdgeValuesForTableColumn(
      edge as any,
      llm as any,
      [edge] as any,
      [llm] as any,
      columns,
    )
    expect(vals).toEqual(["alpha", "bravo", "charlie"])
  })

  it("LLM upstream + Item mode (new format) → splits picked value by list's delimiter", () => {
    const llm = makeNode("llm1", "llm-chat", {
      generatedText: "first|second|third",
    })
    const edge = {
      source: "llm1",
      target: "list1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: { outputMode: "item", itemIndex: "1" },
    }
    const columns = [{ id: "c1", handleId: "col_c1", type: "text" as const, splitDelimiter: "|" }]
    const vals = resolveEdgeValuesForTableColumn(
      edge as any,
      llm as any,
      [edge] as any,
      [llm] as any,
      columns,
    )
    expect(vals).toEqual(["first", "second", "third"])
  })

  it("LLM upstream + Item:1 mode (legacy) → splits picked value by list's delimiter", () => {
    const llm = makeNode("llm1", "llm-chat", {
      generatedText: "x;y;z",
    })
    const edge = {
      source: "llm1",
      target: "list1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: { outputMode: "item:0" },
    }
    const columns = [{ id: "c1", handleId: "col_c1", type: "text" as const, splitDelimiter: ";" }]
    const vals = resolveEdgeValuesForTableColumn(
      edge as any,
      llm as any,
      [edge] as any,
      [llm] as any,
      columns,
    )
    expect(vals).toEqual(["x", "y", "z"])
  })

  it("Already-structured upstream (split-text) + Item mode → does NOT re-split picked item", () => {
    // Picking item 1 from split-text gives one piece — it should land in the
    // list column whole, not chopped further by the column's newline default.
    const split = makeNode("split1", "split-text", {
      splitResults: ["one\ntwo", "three\nfour"],
    })
    const edge = {
      source: "split1",
      target: "list1",
      sourceHandle: null,
      targetHandle: "col_c1_in",
      data: { outputMode: "item", itemIndex: "1" },
    }
    const columns = [{ id: "c1", handleId: "col_c1", type: "text" as const }]
    const vals = resolveEdgeValuesForTableColumn(
      edge as any,
      split as any,
      [edge] as any,
      [split] as any,
      columns,
    )
    expect(vals).toEqual(["one\ntwo"])
  })
})
