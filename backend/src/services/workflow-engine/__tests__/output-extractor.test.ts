import { describe, it, expect } from "vitest"
import {
  extractSourceNodeOutput,
  extractSourceNodeOutputAsList,
  getPrimaryOutput,
  extractSavedNodeOutput,
  buildNodeOutputFromJobData,
  extractAllGeneratedResults,
} from "../output-extractor.js"
import type { SimpleNode, NodeOutput } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

// ---------------------------------------------------------------------------
// extractSourceNodeOutput
// ---------------------------------------------------------------------------

describe("extractSourceNodeOutput", () => {
  it("extracts text from text-prompt", () => {
    const result = extractSourceNodeOutput(node("1", "text-prompt", { text: "Hello world" }))
    expect(result).toEqual({ text: "Hello world" })
  })

  it("returns undefined for empty text-prompt", () => {
    expect(extractSourceNodeOutput(node("1", "text-prompt", { text: "  " }))).toBeUndefined()
  })

  it("returns undefined for text-prompt with no text", () => {
    expect(extractSourceNodeOutput(node("1", "text-prompt", {}))).toBeUndefined()
  })

  it("extracts imageUrl from upload-image", () => {
    const result = extractSourceNodeOutput(node("1", "upload-image", { url: "https://img.jpg" }))
    expect(result).toEqual({ imageUrl: "https://img.jpg" })
  })

  it("extracts videoUrl from upload-video", () => {
    const result = extractSourceNodeOutput(node("1", "upload-video", { url: "https://vid.mp4" }))
    expect(result).toEqual({ videoUrl: "https://vid.mp4" })
  })

  it("extracts audioUrl from upload-audio with r2Url priority", () => {
    const result = extractSourceNodeOutput(node("1", "upload-audio", { r2Url: "https://r2.mp3", url: "https://old.mp3" }))
    expect(result).toEqual({ audioUrl: "https://r2.mp3" })
  })

  it("extracts audioUrl from upload-audio fallback to url", () => {
    const result = extractSourceNodeOutput(node("1", "upload-audio", { url: "https://fallback.mp3" }))
    expect(result).toEqual({ audioUrl: "https://fallback.mp3" })
  })

  it("extracts videoUrl from youtube-video with downloadedVideoUrl priority", () => {
    const result = extractSourceNodeOutput(node("1", "youtube-video", { downloadedVideoUrl: "https://dl.mp4", youtubeUrl: "https://yt.com" }))
    expect(result).toEqual({ videoUrl: "https://dl.mp4" })
  })

  it("extracts youtube-video fallback to youtubeUrl", () => {
    const result = extractSourceNodeOutput(node("1", "youtube-video", { youtubeUrl: "https://yt.com" }))
    expect(result).toEqual({ videoUrl: "https://yt.com" })
  })

  it("extracts audioUrl from reference-audio", () => {
    const result = extractSourceNodeOutput(node("1", "reference-audio", { extractedAudioUrl: "https://ref.mp3" }))
    expect(result).toEqual({ audioUrl: "https://ref.mp3" })
  })

  it("extracts first item from list node (legacy items string)", () => {
    const result = extractSourceNodeOutput(node("1", "list", { items: "cat\ndog\nbird" }))
    expect(result).toEqual({ text: "cat" })
  })

  it("extracts first row from list node (modern columns+rows)", () => {
    const result = extractSourceNodeOutput(node("1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["cat"], ["dog"], ["bird"]],
    }))
    expect(result).toEqual({ text: "cat" })
  })

  it("returns undefined for empty list (legacy)", () => {
    expect(extractSourceNodeOutput(node("1", "list", { items: "" }))).toBeUndefined()
  })

  it("returns undefined for empty list (modern, no rows)", () => {
    expect(extractSourceNodeOutput(node("1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [],
    }))).toBeUndefined()
  })

  it("trims and filters empty lines in list", () => {
    const result = extractSourceNodeOutput(node("1", "list", { items: "  cat  \n\n  dog  " }))
    expect(result).toEqual({ text: "cat" })
  })

  it("extracts first row value from loop node", () => {
    const result = extractSourceNodeOutput(node("1", "loop", { rows: [["hello"], ["world"]] }))
    expect(result).toEqual({ text: "hello" })
  })

  it("returns undefined for loop with no rows", () => {
    expect(extractSourceNodeOutput(node("1", "loop", {}))).toBeUndefined()
  })

  it("extracts webhook-trigger with params", () => {
    const n = node("1", "webhook-trigger", {
      params: [{ id: "p1", name: "prompt", type: "text" }],
    })
    const result = extractSourceNodeOutput(n, { prompt: "test prompt" })
    expect(result?.text).toBe("test prompt")
    expect(result?.paramOutputs?.p1).toBe("test prompt")
  })

  it("extracts webhook-trigger imageUrl param", () => {
    const n = node("1", "webhook-trigger", {
      params: [{ id: "p1", name: "img", type: "imageUrl" }],
    })
    const result = extractSourceNodeOutput(n, { img: "https://img.png" })
    expect(result?.imageUrl).toBe("https://img.png")
    expect(result?.paramOutputs?.p1).toBe("https://img.png")
  })

  it("extracts webhook-trigger legacy format", () => {
    const result = extractSourceNodeOutput(
      node("1", "webhook-trigger", {}),
      { prompt: "hello", imageUrl: "https://img.png" },
    )
    expect(result?.text).toBe("hello")
    expect(result?.imageUrl).toBe("https://img.png")
  })

  it("webhook-trigger returns JSON when no fields match", () => {
    const triggerData = { someField: "value" }
    const result = extractSourceNodeOutput(node("1", "webhook-trigger", {}), triggerData)
    expect(result?.text).toBe(JSON.stringify(triggerData))
  })

  it("webhook-trigger returns undefined with no triggerData", () => {
    expect(extractSourceNodeOutput(node("1", "webhook-trigger", {}))).toBeUndefined()
  })

  it("extracts schedule-trigger with custom text", () => {
    const result = extractSourceNodeOutput(node("1", "schedule-trigger", { text: "scheduled run" }))
    expect(result).toEqual({ text: "scheduled run" })
  })

  it("schedule-trigger falls back to triggerData timestamp", () => {
    const result = extractSourceNodeOutput(
      node("1", "schedule-trigger", {}),
      { timestamp: "2025-01-01T00:00:00Z" },
    )
    expect(result).toEqual({ text: "2025-01-01T00:00:00Z" })
  })

  it("returns undefined for unknown type", () => {
    expect(extractSourceNodeOutput(node("1", "unknown-type"))).toBeUndefined()
  })

  // sub-workflow-input: source node whose value arrives via inputOverrides into
  // data.__injectedPortValues. Without these, the orchestrator can't wire the
  // value to downstream nodes when this workflow runs as a sub-workflow or as
  // a component, and the downstream gen-image / modify-image runs with empty
  // inputs.
  it("extracts injected port values from sub-workflow-input", () => {
    const result = extractSourceNodeOutput(node("1", "sub-workflow-input", {
      __injectedPortValues: { "port-a": "https://cdn/img.png" },
    }))
    expect(result).toEqual({
      text: "https://cdn/img.png",
      _injectedPortValues: { "port-a": "https://cdn/img.png" },
    })
  })

  it("returns undefined for sub-workflow-input without injected values", () => {
    expect(extractSourceNodeOutput(node("1", "sub-workflow-input", {
      ports: [{ id: "port-a", name: "Input", mediaType: "image" }],
      routeId: "r1",
    }))).toBeUndefined()
  })

  it("preserves all port values for sourceHandle-based downstream routing", () => {
    const result = extractSourceNodeOutput(node("1", "sub-workflow-input", {
      __injectedPortValues: {
        "port-img": "https://cdn/i.png",
        "port-txt": "subject text",
      },
    }))
    expect(result?._injectedPortValues).toEqual({
      "port-img": "https://cdn/i.png",
      "port-txt": "subject text",
    })
    // getPrimaryOutput uses sourceHandle to pick the right port at the consumer.
    expect(getPrimaryOutput(result!, "sub-workflow-input", "port-img")).toBe("https://cdn/i.png")
    expect(getPrimaryOutput(result!, "sub-workflow-input", "port-txt")).toBe("subject text")
  })
})

// ---------------------------------------------------------------------------
// extractSourceNodeOutputAsList
// ---------------------------------------------------------------------------

describe("extractSourceNodeOutputAsList", () => {
  it("returns list items when > 1 (legacy items string)", () => {
    const result = extractSourceNodeOutputAsList(node("1", "list", { items: "a\nb\nc" }))
    expect(result).toEqual(["a", "b", "c"])
  })

  it("returns list items when > 1 (modern columns+rows)", () => {
    const result = extractSourceNodeOutputAsList(node("1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["prompt a"], ["prompt b"], ["prompt c"]],
    }))
    expect(result).toEqual(["prompt a", "prompt b", "prompt c"])
  })

  it("returns undefined for single-row modern list (no fan-out)", () => {
    expect(extractSourceNodeOutputAsList(node("1", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["only one"]],
    }))).toBeUndefined()
  })

  it("returns undefined for single item list (legacy)", () => {
    expect(extractSourceNodeOutputAsList(node("1", "list", { items: "only one" }))).toBeUndefined()
  })

  it("returns undefined for empty list", () => {
    expect(extractSourceNodeOutputAsList(node("1", "list", { items: "" }))).toBeUndefined()
  })

  it("returns loop rows when > 1", () => {
    const result = extractSourceNodeOutputAsList(node("1", "loop", { rows: [["a"], ["b"]] }))
    expect(result).toEqual(["a", "b"])
  })

  it("returns undefined for single row loop", () => {
    expect(extractSourceNodeOutputAsList(node("1", "loop", { rows: [["only"]] }))).toBeUndefined()
  })

  it("returns undefined for non-list types", () => {
    expect(extractSourceNodeOutputAsList(node("1", "text-prompt", { text: "hi" }))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getPrimaryOutput
// ---------------------------------------------------------------------------

describe("getPrimaryOutput", () => {
  it("returns imageUrl for image source types", () => {
    expect(getPrimaryOutput({ imageUrl: "img.png" }, "generate-image")).toBe("img.png")
  })

  it("returns videoUrl for video source types", () => {
    expect(getPrimaryOutput({ videoUrl: "vid.mp4" }, "image-to-video")).toBe("vid.mp4")
  })

  it("returns audioUrl for audio source types", () => {
    expect(getPrimaryOutput({ audioUrl: "aud.mp3" }, "text-to-speech")).toBe("aud.mp3")
  })

  it("returns text for text source types", () => {
    expect(getPrimaryOutput({ text: "hello" }, "text-prompt")).toBe("hello")
  })

  it("returns plan-ready marker for plan node types", () => {
    expect(getPrimaryOutput({ plan: { type: "scene-graph" } }, "video-composer")).toBe("plan-ready")
  })

  it("returns undefined for plan nodes with no plan", () => {
    expect(getPrimaryOutput({}, "video-composer")).toBeUndefined()
  })

  it("routes suno-separate vocal handle", () => {
    const output: NodeOutput = { audioUrl: "main.mp3", vocalUrl: "vocal.mp3" }
    expect(getPrimaryOutput(output, "suno-separate", "vocal")).toBe("vocal.mp3")
  })

  it("routes suno-separate instrumental handle", () => {
    const output: NodeOutput = { audioUrl: "main.mp3", instrumentalUrl: "inst.mp3" }
    expect(getPrimaryOutput(output, "suno-separate", "instrumental")).toBe("inst.mp3")
  })

  it("routes voice-design voiceId handle", () => {
    const output: NodeOutput = { audioUrl: "a.mp3", generatedVoiceId: "voice-123" }
    expect(getPrimaryOutput(output, "voice-design", "voiceId")).toBe("voice-123")
  })

  it("routes web-scrape json handle to stringified json output", () => {
    const output: NodeOutput = { json: [{ title: "t", url: "u" }] }
    expect(getPrimaryOutput(output, "web-scrape", "json")).toBe(
      JSON.stringify([{ title: "t", url: "u" }]),
    )
  })

  it("web-scrape returns undefined when json is absent", () => {
    expect(getPrimaryOutput({}, "web-scrape", "json")).toBeUndefined()
  })

  it("routes extract-field to extractedText", () => {
    expect(getPrimaryOutput({ extractedText: "line1\nline2" }, "extract-field")).toBe("line1\nline2")
  })

  it("routes qa-check approved handle", () => {
    expect(getPrimaryOutput({ approved: true, reason: "looks good" }, "qa-check", "approved")).toBe("looks good")
    expect(getPrimaryOutput({ approved: true, reason: "looks good" }, "qa-check", "rejected")).toBeUndefined()
  })

  it("routes qa-check rejected handle", () => {
    expect(getPrimaryOutput({ approved: false, reason: "bad quality" }, "qa-check", "rejected")).toBe("bad quality")
    expect(getPrimaryOutput({ approved: false, reason: "bad quality" }, "qa-check", "approved")).toBeUndefined()
  })

  it("qa-check with undefined approved returns undefined for both handles (parity with frontend)", () => {
    // Unexecuted qa-check: must not fire the rejected branch via truthy check.
    expect(getPrimaryOutput({ reason: "no run yet" }, "qa-check", "approved")).toBeUndefined()
    expect(getPrimaryOutput({ reason: "no run yet" }, "qa-check", "rejected")).toBeUndefined()
    expect(getPrimaryOutput({}, "qa-check", "rejected")).toBeUndefined()
  })

  it("routes adjust-volume by _lastInputType", () => {
    expect(getPrimaryOutput({ videoUrl: "v.mp4", _lastInputType: "video" }, "adjust-volume")).toBe("v.mp4")
    expect(getPrimaryOutput({ audioUrl: "a.mp3", _lastInputType: "audio" }, "adjust-volume")).toBe("a.mp3")
    expect(getPrimaryOutput({ audioUrl: "a.mp3" }, "adjust-volume")).toBe("a.mp3")
  })

  it("routes social-media-format preferring video", () => {
    expect(getPrimaryOutput({ videoUrl: "v.mp4", imageUrl: "i.png" }, "social-media-format")).toBe("v.mp4")
    expect(getPrimaryOutput({ imageUrl: "i.png" }, "social-media-format")).toBe("i.png")
  })

  it("serializes forced-alignment as JSON", () => {
    const alignment = { words: [{ word: "hi", start: 0, end: 0.5 }] }
    expect(getPrimaryOutput({ alignment }, "forced-alignment")).toBe(JSON.stringify(alignment))
  })

  it("routes sub-workflow by handle", () => {
    const output: NodeOutput = { _outputResults: { port1: "val1", port2: "val2" } }
    expect(getPrimaryOutput(output, "sub-workflow", "out_port1")).toBe("val1")
  })

  it("sub-workflow falls back to visibleOutputPortId", () => {
    const output: NodeOutput = {
      _outputResults: { p1: "v1", p2: "v2" },
      _visibleOutputPortId: "p2",
    }
    expect(getPrimaryOutput(output, "sub-workflow")).toBe("v2")
  })

  it("sub-workflow-input routes by handle", () => {
    const output: NodeOutput = { _injectedPortValues: { portA: "valA" } }
    expect(getPrimaryOutput(output, "sub-workflow-input", "portA")).toBe("valA")
  })

  it("falls back to first available for unknown types", () => {
    expect(getPrimaryOutput({ imageUrl: "i.png" }, "unknown-type")).toBe("i.png")
    expect(getPrimaryOutput({ text: "hi" }, "unknown-type")).toBe("hi")
  })
})

// getPrimaryOutput — image-critic sourceHandle dispatch
// ---------------------------------------------------------------------------

describe("getPrimaryOutput — image-critic", () => {
  const approvedOutput: NodeOutput = { approved: true, feedback: "Looks good." }
  const rejectedOutput: NodeOutput = { approved: false, feedback: "Fix the hands." }

  it("approved handle returns feedback when approved=true", () => {
    expect(getPrimaryOutput(approvedOutput, "image-critic", "approved")).toBe("Looks good.")
  })

  it("approved handle returns undefined when approved=false", () => {
    expect(getPrimaryOutput(rejectedOutput, "image-critic", "approved")).toBeUndefined()
  })

  it("rejected handle returns feedback when approved=false", () => {
    expect(getPrimaryOutput(rejectedOutput, "image-critic", "rejected")).toBe("Fix the hands.")
  })

  it("rejected handle returns undefined when approved=true", () => {
    expect(getPrimaryOutput(approvedOutput, "image-critic", "rejected")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getPrimaryOutput: reduce (fan-in)
// ---------------------------------------------------------------------------

describe("getPrimaryOutput: reduce", () => {
  it("returns state.output.result for a reduce node", () => {
    expect(getPrimaryOutput({ result: "joined output" }, "reduce")).toBe("joined output")
  })

  it("returns undefined when reduce has no result", () => {
    expect(getPrimaryOutput({}, "reduce")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractSavedNodeOutput
// ---------------------------------------------------------------------------

describe("extractSavedNodeOutput", () => {
  it("extracts imageUrl from generate-image with generatedResults", () => {
    const n = node("1", "generate-image", {
      generatedResults: [{ url: "img1.png" }, { url: "img2.png" }],
      activeResultIndex: 1,
    })
    expect(extractSavedNodeOutput(n)?.imageUrl).toBe("img2.png")
  })

  it("extracts imageUrl from generate-image fallback to generatedImageUrl", () => {
    const n = node("1", "generate-image", { generatedImageUrl: "fallback.png" })
    expect(extractSavedNodeOutput(n)?.imageUrl).toBe("fallback.png")
  })

  it("extracts videoUrl from image-to-video", () => {
    const n = node("1", "image-to-video", { generatedVideoUrl: "vid.mp4" })
    expect(extractSavedNodeOutput(n)?.videoUrl).toBe("vid.mp4")
  })

  it("extracts videoUrl from generate-video", () => {
    // Unified video node — saved output must be readable identically to i2v/t2v
    // so "Run from here" / DAG resume can hydrate downstream nodes that consume
    // a previously-executed generate-video output without re-running the job.
    const n = node("1", "generate-video", { generatedVideoUrl: "vid.mp4" })
    expect(extractSavedNodeOutput(n)?.videoUrl).toBe("vid.mp4")
  })

  it("extracts audioUrl from text-to-speech", () => {
    const n = node("1", "text-to-speech", { generatedAudioUrl: "speech.mp3" })
    expect(extractSavedNodeOutput(n)?.audioUrl).toBe("speech.mp3")
  })

  it("extracts entity imageUrl from sourceImageUrl", () => {
    for (const type of ["character", "face", "object", "location"]) {
      const n = node("1", type, { sourceImageUrl: "entity.png" })
      expect(extractSavedNodeOutput(n)?.imageUrl).toBe("entity.png")
    }
  })

  it("extracts suno-separate stems", () => {
    const n = node("1", "suno-separate", { vocalUrl: "v.mp3", instrumentalUrl: "i.mp3" })
    const result = extractSavedNodeOutput(n)
    expect(result?.vocalUrl).toBe("v.mp3")
    expect(result?.instrumentalUrl).toBe("i.mp3")
  })

  it("extracts voice-design dual output", () => {
    const n = node("1", "voice-design", { generatedAudioUrl: "a.mp3", generatedVoiceId: "v1" })
    const result = extractSavedNodeOutput(n)
    expect(result?.audioUrl).toBe("a.mp3")
    expect(result?.generatedVoiceId).toBe("v1")
  })

  it("extracts ai-writer text", () => {
    const n = node("1", "ai-writer", { generatedText: "written text" })
    expect(extractSavedNodeOutput(n)?.text).toBe("written text")
  })

  it("llm-chat emits text AND split items", () => {
    const out = extractSavedNodeOutput(node("1", "llm-chat", { generatedText: "p1===NEXT===p2" }))
    expect(out).toMatchObject({ text: "p1===NEXT===p2", items: ["p1", "p2"] })
  })

  it("ai-writer still emits text only (no items)", () => {
    const out = extractSavedNodeOutput(node("1", "ai-writer", { generatedText: "p1===NEXT===p2" }))
    expect(out).toEqual({ text: "p1===NEXT===p2" })
  })

  it("extracts web-scrape json output", () => {
    const n = node("1", "web-scrape", {
      generatedJson: { pages: [{ url: "u", markdown: "m" }] },
    })
    const result = extractSavedNodeOutput(n)
    expect(result?.json).toEqual({ pages: [{ url: "u", markdown: "m" }] })
  })

  it("returns undefined for web-scrape before execution", () => {
    const n = node("1", "web-scrape", {})
    expect(extractSavedNodeOutput(n)).toBeUndefined()
  })

  it("extracts extract-field output with text fallback", () => {
    const n = node("1", "extract-field", { extractedText: "line1\nline2" })
    const result = extractSavedNodeOutput(n)
    expect(result?.extractedText).toBe("line1\nline2")
    expect(result?.text).toBe("line1\nline2")
  })

  it("returns undefined for extract-field before execution", () => {
    const n = node("1", "extract-field", {})
    expect(extractSavedNodeOutput(n)).toBeUndefined()
  })

  it("extracts combine-text", () => {
    const n = node("1", "combine-text", { combinedText: "a + b" })
    expect(extractSavedNodeOutput(n)?.text).toBe("a + b")
  })

  it("extracts split-text", () => {
    const n = node("1", "split-text", { splitResults: ["a", "b"] })
    const result = extractSavedNodeOutput(n)
    expect(result?.text).toBe("a")
    expect(result?.splitResults).toEqual(["a", "b"])
  })

  it("extracts adjust-volume with video lastInputType", () => {
    const n = node("1", "adjust-volume", { generatedVideoUrl: "v.mp4", lastInputType: "video" })
    const result = extractSavedNodeOutput(n)
    expect(result?.videoUrl).toBe("v.mp4")
    expect(result?._lastInputType).toBe("video")
  })

  it("extracts sub-workflow outputResults", () => {
    const n = node("1", "sub-workflow", { outputResults: { p1: "val1" } })
    const result = extractSavedNodeOutput(n)
    expect(result?._outputResults).toEqual({ p1: "val1" })
  })

  it("returns undefined for unknown type with no data", () => {
    expect(extractSavedNodeOutput(node("1", "totally-unknown"))).toBeUndefined()
  })

  it("extracts qa-check approved with saved reason", () => {
    const n = node("1", "qa-check", { approved: true, reason: "looks good" })
    const result = extractSavedNodeOutput(n)
    expect(result?.approved).toBe(true)
    expect(result?.reason).toBe("looks good")
  })

  it("extracts qa-check rejected with saved reason", () => {
    const n = node("1", "qa-check", { approved: false, reason: "bad quality" })
    const result = extractSavedNodeOutput(n)
    expect(result?.approved).toBe(false)
    expect(result?.reason).toBe("bad quality")
  })

  it("qa-check falls back to default reason when missing (matches frontend)", () => {
    expect(extractSavedNodeOutput(node("1", "qa-check", { approved: true }))?.reason).toBe("approved")
    expect(extractSavedNodeOutput(node("1", "qa-check", { approved: false }))?.reason).toBe("rejected")
  })

  it("returns undefined for qa-check without saved approved state", () => {
    expect(extractSavedNodeOutput(node("1", "qa-check", {}))).toBeUndefined()
    expect(extractSavedNodeOutput(node("1", "qa-check", { approved: null }))).toBeUndefined()
    expect(extractSavedNodeOutput(node("1", "qa-check", { reason: "dangling" }))).toBeUndefined()
  })

  it("qa-check saved output routes correctly through getPrimaryOutput by handle", () => {
    const saved = extractSavedNodeOutput(node("1", "qa-check", { approved: true, reason: "ok" }))!
    expect(getPrimaryOutput(saved, "qa-check", "approved")).toBe("ok")
    expect(getPrimaryOutput(saved, "qa-check", "rejected")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildNodeOutputFromJobData
// ---------------------------------------------------------------------------

describe("buildNodeOutputFromJobData", () => {
  it("copies direct output keys", () => {
    const result = buildNodeOutputFromJobData({ imageUrl: "img.png", text: "hi" }, "generate-image")
    expect(result.imageUrl).toBe("img.png")
    expect(result.text).toBe("hi")
  })

  it("normalizes generatedText to text", () => {
    const result = buildNodeOutputFromJobData({ generatedText: "output text" }, "image-to-text")
    expect(result.text).toBe("output text")
  })

  it("normalizes suno lyrics array to text", () => {
    const result = buildNodeOutputFromJobData({
      lyrics: [{ text: "verse 1", title: "Song" }],
    }, "suno-lyrics")
    expect(result.text).toBe("verse 1")
  })

  it("normalizes suno lyrics string to text", () => {
    const result = buildNodeOutputFromJobData({ lyrics: "raw lyrics" }, "suno-lyrics")
    expect(result.text).toBe("raw lyrics")
  })

  it("extracts plan from known plan keys", () => {
    const plan = { type: "scene-graph", tracks: [] }
    const result = buildNodeOutputFromJobData({ plan }, "video-composer")
    expect(result.plan).toEqual(plan)
  })

  it("preserves sunoTrackId and kieTaskId", () => {
    const result = buildNodeOutputFromJobData({
      sunoTrackId: "track-1",
      kieTaskId: "kie-1",
    }, "suno-generate")
    expect(result.sunoTrackId).toBe("track-1")
    expect(result.kieTaskId).toBe("kie-1")
  })

  it("extracts text from generate-script scenes", () => {
    const result = buildNodeOutputFromJobData({
      script: { scenes: [{ imagePrompt: "a beautiful sunset" }] },
    }, "generate-script")
    expect(result.text).toBe("a beautiful sunset")
  })

  it("returns empty output for empty data", () => {
    const result = buildNodeOutputFromJobData({}, "unknown")
    expect(result).toEqual({})
  })

  it("maps reduce output_data.output to NodeOutput.result", () => {
    // Reduce route stores its aggregated string under `output` in jobs.output_data
    // (route response shape: { jobId, output, meta }). The orchestrator reads it
    // back via buildNodeOutputFromJobData and downstream getPrimaryOutput("reduce")
    // returns NodeOutput.result.
    const result = buildNodeOutputFromJobData(
      { output: "joined output", meta: { strategy: "concat", inputs: 3 } },
      "reduce",
    )
    expect(result.result).toBe("joined output")
  })

  it("does not map output->result for non-reduce node types", () => {
    // Defensive: `output` is a generic key name. The mapping must only fire
    // for nodeType === "reduce" so we don't accidentally pick it up if any
    // other future route happens to write `output` into output_data.
    const result = buildNodeOutputFromJobData({ output: "hi" }, "ai-writer")
    expect(result.result).toBeUndefined()
  })

  it("ignores non-string output for reduce (defensive)", () => {
    // The reduce route only writes a string under `output` (numbers are
    // pre-stringified, see reduce.ts:89). If a stub/broken caller writes a
    // non-string, the mapping should skip rather than corrupt NodeOutput.result.
    const result = buildNodeOutputFromJobData(
      { output: { nested: "object" }, meta: {} },
      "reduce",
    )
    expect(result.result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractAllGeneratedResults
// ---------------------------------------------------------------------------

describe("extractAllGeneratedResults", () => {
  it("extractAllGeneratedResults returns single-item array (no 2+ guard)", () => {
    const data = { generatedResults: [{ url: "https://cdn/img1.png" }] }
    const result = extractAllGeneratedResults(data)
    expect(result).toEqual(["https://cdn/img1.png"])
  })
})
