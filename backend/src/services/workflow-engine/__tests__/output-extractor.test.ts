import { describe, it, expect } from "vitest"
import {
  extractSourceNodeOutput,
  extractSourceNodeOutputAsList,
  getPrimaryOutput,
  extractSavedNodeOutput,
  buildNodeOutputFromJobData,
  extractAllGeneratedResults,
  coerceListItemsOverrideToRows,
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

  // Rows-only shape ({ rows } with NO `columns`): `list` must be a TRUE
  // superset of `loop`. normalizeLegacyNodeTypes renames loop→list WITHOUT
  // backfilling `columns`, so a rows-only loop becomes a rows-only list — the
  // `list` branch reads `rows` first (first row's first cell) before falling
  // back to the legacy `items` path. This is the gap the list⊇loop fix closes.
  it("extracts first row value from list node (rows only, no columns)", () => {
    const result = extractSourceNodeOutput(node("1", "list", { rows: [["hello"], ["world"]] }))
    expect(result).toEqual({ text: "hello" })
  })

  it("returns undefined for list with no rows and no items", () => {
    expect(extractSourceNodeOutput(node("1", "list", {}))).toBeUndefined()
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

  // Rows-only (no `columns`) list⊇loop superset: `extractSourceNodeOutputAsList`
  // case "list" reads `rows` directly when `columns` is absent (the renamed
  // loop→list shape) before falling back to the legacy `items` string.
  it("returns list rows when > 1 (rows-only shape, no columns)", () => {
    const result = extractSourceNodeOutputAsList(node("1", "list", { rows: [["a"], ["b"]] }))
    expect(result).toEqual(["a", "b"])
  })

  it("returns undefined for single row rows-only list", () => {
    expect(extractSourceNodeOutputAsList(node("1", "list", { rows: [["only"]] }))).toBeUndefined()
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

  it("routes voice-changer by source handle (audio/video), default prefers video", () => {
    const dual = { videoUrl: "v.mp4", audioUrl: "a.mp3" }
    // Explicit handles select the matching stream.
    expect(getPrimaryOutput(dual, "voice-changer", "audio")).toBe("a.mp3")
    expect(getPrimaryOutput(dual, "voice-changer", "video")).toBe("v.mp4")
    // Default (no handle) prefers video when present, else audio.
    expect(getPrimaryOutput(dual, "voice-changer")).toBe("v.mp4")
    expect(getPrimaryOutput({ audioUrl: "a.mp3" }, "voice-changer")).toBe("a.mp3")
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
// coerceListItemsOverrideToRows  (code-review #1)
//
// A single-column `list` (incl. a migrated former-`loop`) used as a
// published-app input: the runtime ListInputCard writes the user's value as an
// `items: string[]` override. The orchestrator merges that into the node's data
// alongside the snapshot `columns`+`rows`. Both list extractors check
// `if (cols)` FIRST and read the STALE snapshot `rows`, ignoring the override.
// This helper rewrites `rows` from the `items` override so the user's input
// wins for both the scalar and list extraction paths.
// ---------------------------------------------------------------------------

describe("coerceListItemsOverrideToRows", () => {
  it("rewrites rows from an items override on a columns-present list", () => {
    const data: Record<string, unknown> = {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["old"]],
      items: ["new1", "new2"],
    }
    coerceListItemsOverrideToRows(data)
    expect(data.rows).toEqual([["new1"], ["new2"]])
    // Stale `items` is dropped so no downstream reader sees two sources.
    expect(data.items).toBeUndefined()
  })

  it("makes the items override authoritative for list-fan-out extraction (NOT stale rows)", () => {
    // The end-to-end shape: merged node data after the orchestrator applies the
    // `items` override on top of the snapshot. extractSourceNodeOutputAsList must
    // return the user's values, not the snapshot `["old"]`.
    const data: Record<string, unknown> = {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["old"]],
      items: ["new1", "new2"],
    }
    coerceListItemsOverrideToRows(data)
    const asList = extractSourceNodeOutputAsList(node("1", "list", data))
    expect(asList).toEqual(["new1", "new2"])
    // Scalar extractor reads the first row's first cell — also the user's input.
    expect(extractSourceNodeOutput(node("1", "list", data))).toEqual({ text: "new1" })
  })

  it("single-item items override yields a single-cell row (scalar list)", () => {
    const data: Record<string, unknown> = {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["old"]],
      items: ["only"],
    }
    coerceListItemsOverrideToRows(data)
    expect(data.rows).toEqual([["only"]])
    // length 1 → not a fan-out
    expect(extractSourceNodeOutputAsList(node("1", "list", data))).toBeUndefined()
    expect(extractSourceNodeOutput(node("1", "list", data))).toEqual({ text: "only" })
  })

  it("no-op when there are no columns (legacy newline-string list keeps items)", () => {
    const data: Record<string, unknown> = { items: "cat\ndog" }
    coerceListItemsOverrideToRows(data)
    expect(data.items).toBe("cat\ndog")
    expect(data.rows).toBeUndefined()
  })

  it("no-op when items is not an array (string items on a columns list left intact)", () => {
    const data: Record<string, unknown> = {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["keep"]],
      items: "cat\ndog",
    }
    coerceListItemsOverrideToRows(data)
    expect(data.rows).toEqual([["keep"]])
    expect(data.items).toBe("cat\ndog")
  })

  it("is idempotent (second call after conversion is a no-op)", () => {
    const data: Record<string, unknown> = {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["old"]],
      items: ["a", "b"],
    }
    coerceListItemsOverrideToRows(data)
    coerceListItemsOverrideToRows(data)
    expect(data.rows).toEqual([["a"], ["b"]])
    expect(data.items).toBeUndefined()
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

// ---------------------------------------------------------------------------
// generate-mask dual output (regression — backend DAG previously dropped the
// mask, sending the passthrough source image to the "mask" handle so inpaint
// masked the whole frame). Covers all three extractor paths.
// ---------------------------------------------------------------------------

describe("generate-mask dual output (mask vs image handle)", () => {
  it("getPrimaryOutput routes the 'mask' handle to maskUrl, default/'image' to imageUrl", () => {
    const out: NodeOutput = { imageUrl: "https://cdn/src.png", maskUrl: "https://cdn/mask.png" }
    expect(getPrimaryOutput(out, "generate-mask", "mask")).toBe("https://cdn/mask.png")
    expect(getPrimaryOutput(out, "generate-mask", "image")).toBe("https://cdn/src.png")
    expect(getPrimaryOutput(out, "generate-mask")).toBe("https://cdn/src.png")
  })

  it("buildNodeOutputFromJobData copies maskUrl (DIRECT_OUTPUT_KEYS) for the live DAG path", () => {
    const out = buildNodeOutputFromJobData(
      { imageUrl: "https://cdn/src.png", maskUrl: "https://cdn/mask.png" },
      "generate-mask",
    )
    expect(out.imageUrl).toBe("https://cdn/src.png")
    expect(out.maskUrl).toBe("https://cdn/mask.png")
  })

  it("extractSavedNodeOutput hydrates both imageUrl and maskUrl on resume/skip", () => {
    const saved = extractSavedNodeOutput(
      node("m1", "generate-mask", {
        generatedResults: [{ imageUrl: "https://cdn/src.png", maskUrl: "https://cdn/mask.png" }],
        activeResultIndex: 0,
      }),
    )
    expect(saved).toEqual({ imageUrl: "https://cdn/src.png", maskUrl: "https://cdn/mask.png" })
  })

  it("extractSavedNodeOutput falls back to generatedImageUrl/generatedMaskUrl", () => {
    const saved = extractSavedNodeOutput(
      node("m2", "generate-mask", {
        generatedImageUrl: "https://cdn/src.png",
        generatedMaskUrl: "https://cdn/mask.png",
      }),
    )
    expect(saved).toEqual({ imageUrl: "https://cdn/src.png", maskUrl: "https://cdn/mask.png" })
  })
})

// ---------------------------------------------------------------------------
// Resume-path producers that were dropped by extractSavedNodeOutput (M5):
// video-sfx (missing from VIDEO_RESULT_TYPES) and reduce (no saved case).
// ---------------------------------------------------------------------------

describe("extractSavedNodeOutput — video-sfx + reduce resume hydration", () => {
  it("video-sfx hydrates videoUrl from generatedVideoUrl on resume/skip", () => {
    const saved = extractSavedNodeOutput(
      node("s1", "video-sfx", { generatedVideoUrl: "https://cdn/sfx.mp4" }),
    )
    expect(saved).toEqual({ videoUrl: "https://cdn/sfx.mp4" })
  })

  it("reduce hydrates result from data.result on resume/skip", () => {
    const saved = extractSavedNodeOutput(
      node("r1", "reduce", { result: "aggregated text" }),
    )
    expect(saved).toEqual({ result: "aggregated text" })
  })
})
