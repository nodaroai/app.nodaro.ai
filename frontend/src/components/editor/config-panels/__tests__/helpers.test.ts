import { describe, it, expect } from "vitest"
import {
  FIELD_COMPATIBLE_TYPES,
  getCompatibleSources,
  getConnectedSources,
  getConnectedProviderModel,
  extractDisplayValue,
  getModelIdentifier,
  buildCreditModelIdentifier,
} from "../helpers"
import { sunoCreditType, SUNO_SELECT_OPERATIONS, SUNO_MODELS, applyDefaultVideoSelection, buildVideoCreditModelIdentifier, mergeNodeInputOverrides, DEFAULT_TRANSCRIBE_NODE_PROVIDER } from "@nodaro/shared"
import type { SourceNodeInfo } from "../types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function makeSource(overrides: Partial<SourceNodeInfo> = {}): SourceNodeInfo {
  return {
    id: "src-1",
    type: "text-prompt",
    label: "Prompt",
    value: "hello",
    ...overrides,
  }
}

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "n1",
    type: "text-prompt",
    position: { x: 0, y: 0 },
    data: { label: "Test", text: "hello" },
    ...overrides,
  } as WorkflowNode
}

function makeEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: "e1",
    source: "n1",
    target: "n2",
    ...overrides,
  } as WorkflowEdge
}

describe("FIELD_COMPATIBLE_TYPES", () => {
  it("has entries for prompt, negativePrompt, style, provider, etc.", () => {
    expect(FIELD_COMPATIBLE_TYPES.prompt).toContain("text-prompt")
    expect(FIELD_COMPATIBLE_TYPES.negativePrompt).toContain("text-prompt")
    expect(FIELD_COMPATIBLE_TYPES.style).toContain("style-guide")
    expect(FIELD_COMPATIBLE_TYPES.provider).toContain("provider")
    expect(FIELD_COMPATIBLE_TYPES.aspectRatio).toContain("aspect-ratio")
    expect(FIELD_COMPATIBLE_TYPES.duration).toContain("duration")
  })

  it("tone accepts both text-prompt and tone", () => {
    expect(FIELD_COMPATIBLE_TYPES.tone).toContain("text-prompt")
    expect(FIELD_COMPATIBLE_TYPES.tone).toContain("tone")
  })
})

describe("getCompatibleSources", () => {
  const textSource = makeSource({ id: "s1", type: "text-prompt" })
  const providerSource = makeSource({ id: "s2", type: "provider", providerCategory: "image" })
  const styleSource = makeSource({ id: "s3", type: "style-guide" })

  it("filters sources by compatible type (text sources, provider excluded)", () => {
    // `prompt` now accepts all text-producing source types (text-prompt,
    // llm-chat, style-guide, parameter nodes, etc.) — the whitelist was
    // previously over-narrow (`text-prompt` only), hiding the dropdown
    // whenever any other text source was wired. Provider source still
    // excluded because it's not text.
    const result = getCompatibleSources("prompt", [textSource, providerSource, styleSource])
    expect(result.map((r) => r.id).sort()).toEqual(["s1", "s3"])
    expect(result.find((r) => r.type === "provider")).toBeUndefined()
  })

  it("returns all sources when field has no type restriction", () => {
    const result = getCompatibleSources("unknownField", [textSource, providerSource])
    expect(result).toHaveLength(2)
  })

  it("filters provider sources by category", () => {
    const imageProvider = makeSource({ id: "p1", type: "provider", providerCategory: "image" })
    const videoProvider = makeSource({ id: "p2", type: "provider", providerCategory: "video" })
    const result = getCompatibleSources("provider", [imageProvider, videoProvider], "image")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p1")
  })

  it("allows all provider categories when providerCategory is not specified", () => {
    const imageProvider = makeSource({ id: "p1", type: "provider", providerCategory: "image" })
    const videoProvider = makeSource({ id: "p2", type: "provider", providerCategory: "video" })
    const result = getCompatibleSources("provider", [imageProvider, videoProvider])
    expect(result).toHaveLength(2)
  })

  it("deduplicates sources by id", () => {
    const dup1 = makeSource({ id: "same", type: "text-prompt" })
    const dup2 = makeSource({ id: "same", type: "text-prompt" })
    const result = getCompatibleSources("prompt", [dup1, dup2])
    expect(result).toHaveLength(1)
  })

  it("returns empty array when no sources match", () => {
    const result = getCompatibleSources("prompt", [providerSource])
    expect(result).toHaveLength(0)
  })
})

describe("getConnectedSources", () => {
  it("returns sources connected to the target node", () => {
    const nodes = [makeNode({ id: "n1", type: "text-prompt", data: { label: "Prompt", text: "hi" } })]
    const edges = [makeEdge({ source: "n1", target: "n2" })]
    const result = getConnectedSources("n2", edges, nodes)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("n1")
    expect(result[0].type).toBe("text-prompt")
  })

  it("ignores edges not targeting this node", () => {
    const nodes = [makeNode({ id: "n1" })]
    const edges = [makeEdge({ source: "n1", target: "n3" })]
    const result = getConnectedSources("n2", edges, nodes)
    expect(result).toHaveLength(0)
  })

  it("skips edges with missing source nodes", () => {
    const edges = [makeEdge({ source: "missing", target: "n2" })]
    const result = getConnectedSources("n2", edges, [])
    expect(result).toHaveLength(0)
  })

  it("sets providerCategory for provider nodes", () => {
    const nodes = [makeNode({ id: "n1", type: "provider", data: { label: "P", category: "image", provider: "flux", model: "flux-pro" } })]
    const edges = [makeEdge({ source: "n1", target: "n2" })]
    const result = getConnectedSources("n2", edges, nodes)
    expect(result[0].providerCategory).toBe("image")
  })

  it("does not set providerCategory for non-provider nodes", () => {
    const nodes = [makeNode({ id: "n1", type: "text-prompt", data: { label: "P", text: "hi" } })]
    const edges = [makeEdge({ source: "n1", target: "n2" })]
    const result = getConnectedSources("n2", edges, nodes)
    expect(result[0].providerCategory).toBeUndefined()
  })
})

describe("getConnectedProviderModel", () => {
  it("returns model from connected provider node", () => {
    const fieldMappings = { provider: { sourceNodeId: "p1" } }
    const sources: SourceNodeInfo[] = [makeSource({ id: "p1", type: "provider" })]
    const nodes = [makeNode({ id: "p1", type: "provider", data: { provider: "flux", model: "flux-pro" } as any })]
    const result = getConnectedProviderModel(fieldMappings, sources, nodes)
    expect(result).toBe("flux-pro")
  })

  it("returns undefined when no provider mapping exists", () => {
    const result = getConnectedProviderModel({}, [], [])
    expect(result).toBeUndefined()
  })

  it("returns undefined when source is not a provider type", () => {
    const fieldMappings = { provider: { sourceNodeId: "s1" } }
    const sources: SourceNodeInfo[] = [makeSource({ id: "s1", type: "text-prompt" })]
    const nodes = [makeNode({ id: "s1" })]
    const result = getConnectedProviderModel(fieldMappings, sources, nodes)
    expect(result).toBeUndefined()
  })

  it("returns undefined when source node is not found in nodes array", () => {
    const fieldMappings = { provider: { sourceNodeId: "p1" } }
    const sources: SourceNodeInfo[] = [makeSource({ id: "p1", type: "provider" })]
    const result = getConnectedProviderModel(fieldMappings, sources, [])
    expect(result).toBeUndefined()
  })
})

describe("extractDisplayValue", () => {
  it("returns text for text-prompt", () => {
    expect(extractDisplayValue({ text: "hello world" }, "text-prompt")).toBe("hello world")
  })

  it("returns tone for tone", () => {
    expect(extractDisplayValue({ tone: "serious" }, "tone")).toBe("serious")
  })

  it("returns text for style-guide", () => {
    expect(extractDisplayValue({ text: "dark moody" }, "style-guide")).toBe("dark moody")
  })

  it("returns provider/model for provider", () => {
    expect(extractDisplayValue({ provider: "flux", model: "flux-pro" }, "provider")).toBe("flux/flux-pro")
  })

  it("returns count + scenes for scene-count", () => {
    expect(extractDisplayValue({ count: 5 }, "scene-count")).toBe("5 scenes")
  })

  it("returns seconds + s for duration", () => {
    expect(extractDisplayValue({ seconds: 10 }, "duration")).toBe("10s")
  })

  it("returns ratio for aspect-ratio", () => {
    expect(extractDisplayValue({ ratio: "16:9" }, "aspect-ratio")).toBe("16:9")
  })

  it("returns motion for motion", () => {
    expect(extractDisplayValue({ motion: "slow" }, "motion")).toBe("slow")
  })

  it("returns 'Audio ready' when reference-audio has videoTitle", () => {
    expect(extractDisplayValue({ videoTitle: "Song" }, "reference-audio")).toBe("Audio ready")
  })

  it("returns label as fallback for unknown node type", () => {
    expect(extractDisplayValue({ label: "My Node" }, "custom-thing")).toBe("My Node")
  })

  it("returns empty string when data is missing for text-prompt", () => {
    expect(extractDisplayValue({}, "text-prompt")).toBe("")
  })
})

describe("getModelIdentifier", () => {
  it("text-to-audio: the per-second row for the node's length — the row the run reserves", () => {
    const t2a = (data: Record<string, unknown>) =>
      makeNode({ id: "t1", type: "text-to-audio", data: { label: "SFX", prompt: "rain", ...data } } as Partial<WorkflowNode>)
    expect(getModelIdentifier(t2a({ provider: "elevenlabs-sfx", duration: 10 }))).toBe("elevenlabs-sfx:10s")
    expect(getModelIdentifier(t2a({ provider: "elevenlabs-sfx", duration: 0.5 }))).toBe("elevenlabs-sfx:1s")
    expect(getModelIdentifier(t2a({ provider: "elevenlabs-sfx", duration: 22.3 }))).toBe("elevenlabs-sfx:23s")
    // No duration → billed as 5 s; no provider → the default engine's row.
    expect(getModelIdentifier(t2a({ provider: "elevenlabs-sfx" }))).toBe("elevenlabs-sfx:5s")
    expect(getModelIdentifier(t2a({ duration: 8 }))).toBe("elevenlabs-sfx:8s")
  })

  it("prices Video SFX at the row for the wired clip's length, the 8s row when it is unknown", () => {
    const sfx = makeNode({ id: "sfx", type: "video-sfx", data: { label: "SFX", provider: "replicate-mmaudio" } as any })
    const clip = makeNode({ id: "clip", type: "upload-video", data: { label: "Clip", videoDuration: 42 } as any })
    const wire = makeEdge({ source: "clip", target: "sfx", targetHandle: "video" })
    expect(getModelIdentifier(sfx, [wire], [clip, sfx])).toBe("replicate-mmaudio:60s")
    expect(getModelIdentifier(sfx)).toBe("replicate-mmaudio:8s")
  })

  it("prices Video Retake at its per-second row (the estimate multiplies by the window)", () => {
    const node = makeNode({ type: "video-retake", data: { label: "Retake", provider: "ltx-2.3-pro", retakeDuration: 4 } as any })
    expect(getModelIdentifier(node)).toBe("ltx-2.3-pro-retake:per-second")
  })

  it("prices LTX 2.3 Pro Extend at its per-second row (the estimate multiplies by the seconds)", () => {
    const node = makeNode({ type: "extend-video", data: { label: "Extend", provider: "ltx-2.3-pro", duration: 12 } as any })
    expect(getModelIdentifier(node)).toBe("ltx-2.3-pro-extend:per-second")
  })

  it("returns the llm credit identifier for llm-chat nodes", () => {
    const node = makeNode({ type: "llm-chat", data: { label: "Generate Text", llmModel: "claude-sonnet-4.6" } as any })
    expect(getModelIdentifier(node)).toBe("llm-chat")
  })

  it("bumps the displayed tier for xhigh/max effort (matches guard + reservation)", () => {
    const node = makeNode({ type: "llm-chat", data: { label: "Generate Text", llmModel: "gpt-5.6-terra", reasoningEffort: "max" } as any })
    expect(getModelIdentifier(node)).toBe("llm-chat:premium")
  })

  it("bumps the lottie-engine motion-graphics identifier on max effort", () => {
    const node = makeNode({ type: "motion-graphics", data: { label: "MG", engine: "lottie", llmModel: "gpt-5.6-terra", reasoningEffort: "max" } as any })
    expect(getModelIdentifier(node)).toBe("motion-graphics-lottie:premium")
  })

  it("returns provider from node data when available", () => {
    const node = makeNode({ type: "generate-image", data: { label: "Img", provider: "flux" } as any })
    expect(getModelIdentifier(node)).toBe("flux")
  })

  it("returns node type when no provider in data", () => {
    const node = makeNode({ type: "generate-image", data: { label: "Img" } as any })
    expect(getModelIdentifier(node)).toBe("generate-image")
  })

  it("returns 'unknown' when node has no type and no provider", () => {
    const node = makeNode({ type: undefined as any, data: { label: "X" } as any })
    expect(getModelIdentifier(node)).toBe("unknown")
  })

  // A provider-less VIDEO node is not an unpriced node: the routes and the
  // orchestrator both fill the provider from applyDefaultVideoSelection, so
  // the estimate must quote that model. Falling through to the bare node type
  // asked GET /v1/credits/model-cost for "generate-video" — no pricing row, so
  // 503 price_not_configured and a blank cost on the Run button (production
  // app-report, 2026-09-13).
  it.each(["generate-video", "image-to-video", "text-to-video"])(
    "%s with no provider quotes the default video model, not the bare node type",
    (type) => {
      const id = getModelIdentifier(makeNode({ type: type as any, data: { label: "Vid" } as any }))
      expect(id).not.toBe(type)
      expect(id.length).toBeGreaterThan(0)
      // Identical to what the route/orchestrator will select for the same data.
      const sel = applyDefaultVideoSelection({ provider: undefined, duration: undefined })
      expect(id).toBe(
        buildVideoCreditModelIdentifier(
          sel.provider,
          sel.duration,
          undefined,
          type === "text-to-video" ? "text-to-video" : "image-to-video",
          undefined,
          undefined,
          false,
        ),
      )
    },
  )

  it("an explicit video provider still wins over the default", () => {
    const node = makeNode({ type: "generate-video", data: { label: "Vid", provider: "kling", duration: 5 } as any })
    expect(getModelIdentifier(node)).toBe(
      buildVideoCreditModelIdentifier("kling", 5, undefined, "image-to-video", undefined, undefined, false),
    )
  })

  // Flux 2 is priced per megapixel and its identifier INTERPOLATES the
  // resolution. A node carrying another model's token ("2K") used to build
  // "flux-2-pro:2KMP:0ref" — unpriced, so the badge 503'd (18 app-reports).
  it("a flux-2 node carrying a foreign resolution token still asks for a priced id", () => {
    const node = makeNode({ type: "generate-image", data: { label: "Img", provider: "flux-2-pro", resolution: "2K" } as any })
    expect(getModelIdentifier(node)).toBe("flux-2-pro:2MP:0ref")
  })

  it("motion-graphics defaults to the elements feature", () => {
    const node = makeNode({ type: "motion-graphics", data: { label: "MG" } as any })
    expect(getModelIdentifier(node)).toBe("motion-graphics")
  })

  // edit-plan run-estimate: a composite mode×tier×duration-bucket id from the
  // MASTER source's length — NOT the bare "edit-plan" (the video-analysis
  // under-quote trap). The audio master's length lives on metadata.durationSeconds.
  it("edit-plan buckets on the wired audio master's duration (metadata lane)", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "clips", planTier: "premium" } as any })
    const audio = makeNode({ id: "a1", type: "upload-audio", data: { label: "A", metadata: { durationSeconds: 45 * 60 } } as any })
    const edges: WorkflowEdge[] = [{ id: "e1", source: "a1", target: "ep", targetHandle: "sources" } as WorkflowEdge]
    // 45 min → the 60m bucket.
    expect(getModelIdentifier(editPlan, edges, [editPlan, audio])).toBe("edit-plan:clips:premium:60m")
  })

  it("edit-plan trailer mode prices its own composite (Track D1)", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "trailer", planTier: "standard" } as any })
    const audio = makeNode({ id: "a1", type: "upload-audio", data: { label: "A", metadata: { durationSeconds: 45 * 60 } } as any })
    const edges: WorkflowEdge[] = [{ id: "e1", source: "a1", target: "ep", targetHandle: "sources" } as WorkflowEdge]
    expect(getModelIdentifier(editPlan, edges, [editPlan, audio])).toBe("edit-plan:trailer:standard:60m")
  })

  it("edit-plan with no wired source falls to the tier's ceiling bucket, never the bare id", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    expect(getModelIdentifier(editPlan, [], [editPlan])).toBe("edit-plan:tighten:standard:180m")
  })

  // A URL-sourced master (YouTube / reference-audio) carries NO readable length
  // on its node data. The estimate must NOT borrow one from the wired transcript:
  // the browser only holds the PREVIOUS run's, reusing a workflow for a longer
  // episode is the normal case, and Execute-All prechecks the balance against
  // this id — a stale 12-minute transcript would pass the precheck, charge
  // Transcribe, then fail the Edit Plan reserve mid-run. Ceiling = refuse up front.
  it("edit-plan with a URL master quotes the ceiling even when a transcript is wired (never under-quotes)", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const urlMaster = makeNode({ id: "ref", type: "reference-audio", data: { label: "Episode", audioUrl: "https://youtu.be/x" } as any })
    const lastWeeks = { language: "en", words: [{ text: "bye", startMs: 0, endMs: 12 * 60_000 }] }
    const transcribe = makeNode({
      id: "tr", type: "transcribe",
      data: { label: "T", activeResultIndex: 0, generatedJson: lastWeeks, generatedResults: [{ text: "bye", jobId: "j", timestamp: "t", transcript: lastWeeks }] } as any,
    })
    const edges = [
      { id: "e1", source: "ref", target: "ep", targetHandle: "sources" },
      { id: "e2", source: "tr", sourceHandle: "json", target: "ep", targetHandle: "transcript" },
    ] as WorkflowEdge[]
    expect(getModelIdentifier(editPlan, edges, [editPlan, urlMaster, transcribe])).toBe("edit-plan:tighten:standard:180m")
  })

  // …and this is how that URL master gets out of the ceiling: the extraction
  // worker measures the file and the length is written ON the master node, in the
  // same patch as its media (referenceAudioMediaPatch), so it can never go stale.
  it("edit-plan with a URL master that recorded its extracted length quotes the real bucket", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const urlMaster = makeNode({
      id: "ref", type: "reference-audio",
      data: { label: "Episode", sourceType: "youtube", youtubeUrl: "https://youtu.be/x", extractedAudioUrl: "https://cdn/a.mp3", extractionStatus: "ready", metadata: { durationSeconds: 59.4 * 60, mediaUrl: "https://cdn/a.mp3" } } as any,
    })
    const edges = [{ id: "e1", source: "ref", target: "ep", targetHandle: "sources" }] as WorkflowEdge[]
    expect(getModelIdentifier(editPlan, edges, [editPlan, urlMaster])).toBe("edit-plan:tighten:standard:60m")
  })

  // The same node after an agent replaced its audio with a shallow patch (copilot
  // `patchNodes`, MCP update_workflow_json): `metadata` rode along, but its stamp
  // no longer matches the media, so the length reads as unknown — ceiling, never
  // last episode's 12 minutes against a 3-hour file.
  it("edit-plan: a URL master whose audio was swapped under a stale stamped length quotes the ceiling", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const urlMaster = makeNode({
      id: "ref", type: "reference-audio",
      data: { label: "Episode", extractedAudioUrl: "https://host/ep42-3h.mp3", extractionStatus: "ready", metadata: { durationSeconds: 720, mediaUrl: "https://cdn/ep41.mp3" } } as any,
    })
    const edges = [{ id: "e1", source: "ref", target: "ep", targetHandle: "sources" }] as WorkflowEdge[]
    expect(getModelIdentifier(editPlan, edges, [editPlan, urlMaster])).toBe("edit-plan:tighten:standard:180m")
  })

  // An app run that swaps the master's audio must NOT bucket on the publisher's
  // recorded length: the presentation estimate merges run inputs through
  // mergeNodeInputOverrides, which drops the media-bound metadata with the media.
  it("edit-plan: after a run input swaps the URL master's audio, the estimate is the ceiling again", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const saved = { label: "Episode", sourceType: "youtube", extractedAudioUrl: "https://cdn/publisher-10min.mp3", extractionStatus: "ready", metadata: { durationSeconds: 600 } }
    const swapped = mergeNodeInputOverrides("reference-audio", saved, { extractedAudioUrl: "https://cdn/caller-60min.mp3" })
    const urlMaster = makeNode({ id: "ref", type: "reference-audio", data: swapped as any })
    const edges = [{ id: "e1", source: "ref", target: "ep", targetHandle: "sources" }] as WorkflowEdge[]
    // Publisher's 10 min would have quoted :15m — a 4x under-quote of the caller's hour.
    expect(getModelIdentifier(editPlan, edges, [editPlan, urlMaster])).toBe("edit-plan:tighten:standard:180m")
  })

  // The config panel's Run button and the presentation view used to call this
  // WITHOUT the graph nodes, so the master lane was blind there and they quoted
  // the ceiling while the node's own pill quoted the real bucket.
  it("edit-plan without the graph nodes cannot see the master — callers must pass them", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const audio = makeNode({ id: "a1", type: "upload-audio", data: { label: "A", metadata: { durationSeconds: 45 * 60 } } as any })
    const edges = [{ id: "e1", source: "a1", target: "ep", targetHandle: "sources" }] as WorkflowEdge[]
    expect(getModelIdentifier(editPlan, edges)).toBe("edit-plan:tighten:standard:180m")
    expect(getModelIdentifier(editPlan, edges, [editPlan, audio])).toBe("edit-plan:tighten:standard:60m")
  })

  it("edit-plan buckets on the master's length, not on the wired transcript's", () => {
    const editPlan = makeNode({ id: "ep", type: "edit-plan", data: { label: "EP", mode: "tighten", planTier: "standard" } as any })
    const audio = makeNode({ id: "a1", type: "upload-audio", data: { label: "A", metadata: { durationSeconds: 100 * 60 } } as any })
    // Speech ends at 20 min; the file runs 100 — the reserve bills the FILE.
    const transcribe = makeNode({ id: "tr", type: "transcribe", data: { label: "T", generatedJson: { words: [{ endMs: 20 * 60_000 }] } } as any })
    const edges = [
      { id: "e1", source: "a1", target: "ep", targetHandle: "sources" },
      { id: "e2", source: "tr", sourceHandle: "json", target: "ep", targetHandle: "transcript" },
    ] as WorkflowEdge[]
    expect(getModelIdentifier(editPlan, edges, [editPlan, audio, transcribe])).toBe("edit-plan:tighten:standard:120m")
  })

  it("motion-graphics with engine 'lottie' uses the lottie feature", () => {
    const node = makeNode({ type: "motion-graphics", data: { label: "MG", engine: "lottie" } as any })
    expect(getModelIdentifier(node)).toBe("motion-graphics-lottie")
  })

  // Composite-only-priced nodes: getModelIdentifier must return the SAME seeded
  // composite the per-node cost pill uses (resolveAiAvatarCreditId /
  // resolveCinematicCreditId / referenceSheetCreditId), NOT the bare provider/
  // type key — the bare key is intentionally unpriced and made the model-costs
  // batch warn "operator must seed: heygen, reference-sheet".
  it("ai-avatar returns a seeded heygen composite, not the bare 'heygen' key", () => {
    const node = makeNode({ type: "ai-avatar", data: { label: "Avatar", provider: "heygen" } as any })
    const id = getModelIdentifier(node)
    expect(id).not.toBe("heygen")
    expect(id).toMatch(/^heygen-/)
  })

  it("cinematic-avatar returns a seeded composite, not the bare 'heygen' key", () => {
    const node = makeNode({ type: "cinematic-avatar", data: { label: "Cinematic", provider: "heygen" } as any })
    const id = getModelIdentifier(node)
    expect(id).not.toBe("heygen")
    expect(id.length).toBeGreaterThan(0)
  })

  it("reference-sheet returns the assembly composite, not the bare type key", () => {
    const node = makeNode({ type: "reference-sheet", data: { label: "Sheet" } as any })
    expect(getModelIdentifier(node)).toBe("reference-sheet:assembly")
  })

  it("reference-sheet motion flavour returns the motion-assembly composite", () => {
    const node = makeNode({ type: "reference-sheet", data: { label: "Sheet", flavour: { outputFormat: "motion" } } as any })
    expect(getModelIdentifier(node)).toBe("reference-sheet:assembly-motion")
  })

  // SwitchX: frame-tier × resolution priced, but the editor can't know the frame
  // count pre-run, so getModelIdentifier returns the resolution-aware WORST-CASE
  // (240-frame) tier — one consistent SAFE UPPER bound shared by the run-button
  // pill, the run-confirm gate and the precheck. The bare `beeble-switchx` key is
  // the resolution-BLIND 1080p worst-case and must NEVER be used for a 720p node
  // (it caused a 120-warning vs 25-pill vs 40-actual price inconsistency).
  it("switchx returns the resolution-aware 240-frame worst-case, not the bare key", () => {
    const id720 = getModelIdentifier(makeNode({ type: "switchx", data: { label: "Relight", provider: "beeble-switchx", maxResolution: 720 } as any }))
    const id1080 = getModelIdentifier(makeNode({ type: "switchx", data: { label: "Relight", provider: "beeble-switchx", maxResolution: 1080 } as any }))
    expect(id720).toBe("beeble-switchx:240f:720p")
    expect(id1080).toBe("beeble-switchx:240f:1080p")
    expect(id720).not.toBe("beeble-switchx")
  })

  // Suno: the live-cost path must quote the key routes/suno.ts actually
  // reserves. generate/cover/extend are version-priced; every other Suno
  // operation charges a flat per-operation key regardless of the version the
  // node carries (every Suno node now defaults to DEFAULT_SUNO_MODEL = V6;
  // the older versions below are still offered and still price per version).
  it("suno-generate V6 (the default) returns the V6 version key", () => {
    const node = makeNode({ type: "suno-generate", data: { label: "Suno", model: "V6" } as any })
    expect(getModelIdentifier(node)).toBe("suno-v6")
  })

  it("suno-generate V5_5 returns the version key", () => {
    const node = makeNode({ type: "suno-generate", data: { label: "Suno", model: "V5_5" } as any })
    expect(getModelIdentifier(node)).toBe("suno-v5_5")
  })

  it("suno-cover V5 returns the version key", () => {
    const node = makeNode({ type: "suno-cover", data: { label: "Cover", model: "V5" } as any })
    expect(getModelIdentifier(node)).toBe("suno-v5")
  })

  it("suno-extend V4 falls back to the operation key", () => {
    const node = makeNode({ type: "suno-extend", data: { label: "Extend", model: "V4" } as any })
    expect(getModelIdentifier(node)).toBe("suno-extend")
  })

  it("suno-mashup V5_5 returns the FLAT operation key, not the version key", () => {
    const node = makeNode({ type: "suno-mashup", data: { label: "Mashup", model: "V5_5" } as any })
    expect(getModelIdentifier(node)).toBe("suno-mashup")
  })

  it("suno-add-vocals V5 returns the FLAT operation key, not suno-v5", () => {
    const node = makeNode({ type: "suno-add-vocals", data: { label: "Vocals", model: "V5" } as any })
    expect(getModelIdentifier(node)).toBe("suno-add-vocals")
  })

  it("suno-separate keeps its own stem/vocal axis", () => {
    const node = makeNode({ type: "suno-separate", data: { label: "Sep", type: "split_stem", model: "V5" } as any })
    expect(getModelIdentifier(node)).toBe("suno-separate-stem")
  })

  // Wiring check: getModelIdentifier's Suno branch must delegate to
  // sunoCreditType for EVERY select operation, not just the ones spot-checked
  // above. Derived from the shared SUNO_SELECT_OPERATIONS / SUNO_MODELS lists
  // (owned by Task 1) rather than re-listed here, so this stays correct if
  // the operation set ever grows.
  it("matches sunoCreditType for every Suno select operation and model version", () => {
    for (const operation of SUNO_SELECT_OPERATIONS) {
      for (const model of SUNO_MODELS) {
        const node = makeNode({ type: operation, data: { label: operation, model } as any })
        expect(getModelIdentifier(node)).toBe(sunoCreditType(model, operation))
      }
    }
  })

  // Add Captions: the badge must quote the row the run RESERVES, and that row
  // follows the RENDERER, not the style — same predicate as the route's credit
  // id and the DAG payload-builder. Style alone under-quoted every subtitle
  // that still renders through Remotion.
  describe("add-captions", () => {
    const captions = (data: Record<string, unknown>) =>
      makeNode({ id: "ac", type: "add-captions", data: { label: "Captions", style: "subtitle", ...data } as any })

    it("a plain subtitle burning inline text stays on the cheap FFmpeg row", () => {
      expect(getModelIdentifier(captions({ text: "hello" }), [])).toBe("add-captions")
    })

    it("a kinetic style is Remotion", () => {
      expect(getModelIdentifier(captions({ style: "word-pop", text: "hello" }), [])).toBe("add-captions:kinetic")
    })

    it("a styled subtitle is Remotion — one lever at a time", () => {
      for (const lever of [
        { fontWeight: 700 },
        { strokeWidth: 4 },
        { positionY: 65 },
        { maxWordsPerLine: 3 },
        { look: "outline" },
        { uppercase: true },
        { fontFamily: "Montserrat" },
      ]) {
        expect(getModelIdentifier(captions({ text: "hello", ...lever }), []), JSON.stringify(lever)).toBe(
          "add-captions:kinetic",
        )
      }
    })

    // The canvas node has no text field and only takes a video + a Transcript,
    // so a bare subtitle auto-transcribes: timed captions, Remotion, and the
    // kinetic row is what the run actually reserves.
    it("an auto-transcribing subtitle (no text — the canvas default) is Remotion", () => {
      expect(getModelIdentifier(captions({}), [])).toBe("add-captions:kinetic")
    })

    it("a wired Transcript makes even a plain subtitle Remotion", () => {
      const node = captions({ text: "hello" })
      const edges = [makeEdge({ id: "e", source: "t1", target: "ac", sourceHandle: "json", targetHandle: "transcript" })]
      expect(getModelIdentifier(node, edges)).toBe("add-captions:kinetic")
    })

    // A transcribe node wired into the node's DEFAULT handle feeds captions the
    // same way (input-resolver fills `captions`/`prompt` from it), so the graph
    // fact, not the handle name, is what decides.
    it("a transcribe node wired in on any handle makes even a plain subtitle Remotion", () => {
      const node = captions({ text: "hello" })
      const edges = [makeEdge({ id: "e", source: "t1", target: "ac", sourceHandle: "json", targetHandle: "in" })]
      const nodes = [node, makeNode({ id: "t1", type: "transcribe", data: { label: "Transcribe" } as any })]
      expect(getModelIdentifier(node, edges, nodes)).toBe("add-captions:kinetic")
    })

    // An estimate may over-quote, never under-quote: with no edges to read, the
    // graph fact is invisible and the pricier family is the only safe answer.
    it("unknown edges quote the pricier family", () => {
      expect(getModelIdentifier(captions({ text: "hello" }))).toBe("add-captions:kinetic")
    })

    // `{Label}` can resolve to nothing at run time, which leaves transcription
    // as the only source — so a ref does not prove the cheap lane.
    it("a {Label} reference in the text does not prove the cheap lane", () => {
      expect(getModelIdentifier(captions({ text: "{Script}" }), [])).toBe("add-captions:kinetic")
    })
  })

  // Transcribe reserves on the ENGINE (execute-node sends
  // `d.provider || DEFAULT_TRANSCRIBE_NODE_PROVIDER`, payload-builder reserves
  // that lane), so a provider-less node must not be quoted on the bare node key.
  describe("transcribe", () => {
    it("a provider-less node quotes the default engine, never the bare node type", () => {
      const node = makeNode({ id: "t1", type: "transcribe", data: { label: "Transcribe" } as any })
      expect(getModelIdentifier(node, [])).toBe(DEFAULT_TRANSCRIBE_NODE_PROVIDER)
      expect(getModelIdentifier(node, [])).not.toBe("transcribe")
    })

    it("a named engine is quoted as itself", () => {
      for (const provider of ["whisper", "incredibly-fast-whisper", "elevenlabs-stt"]) {
        const node = makeNode({ id: "t1", type: "transcribe", data: { label: "Transcribe", provider } as any })
        expect(getModelIdentifier(node, [])).toBe(provider)
      }
    })
  })
})

describe("buildCreditModelIdentifier", () => {
  it("returns 'topaz-image-upscale' for 2K (default, no suffix)", () => {
    expect(buildCreditModelIdentifier("topaz-image-upscale", { targetResolution: "2K" })).toBe("topaz-image-upscale")
  })

  it("returns 'topaz-image-upscale:4K' for 4K", () => {
    expect(buildCreditModelIdentifier("topaz-image-upscale", { targetResolution: "4K" })).toBe("topaz-image-upscale:4K")
  })

  it("returns 'topaz-image-upscale:4K' for the legacy 8K target", () => {
    // 8K maps to the 4x tier — resolveTopazUpscale (the provider has no 8x factor).
    expect(buildCreditModelIdentifier("topaz-image-upscale", { targetResolution: "8K" })).toBe("topaz-image-upscale:4K")
  })

  it("prices the explicit 4x factor at the 4K tier even with no targetResolution", () => {
    expect(buildCreditModelIdentifier("topaz-image-upscale", { upscaleFactor: "4" })).toBe("topaz-image-upscale:4K")
  })

  it("lets an explicit 2x factor override a stored 4K/8K target (bare tier)", () => {
    expect(buildCreditModelIdentifier("topaz-image-upscale", { upscaleFactor: "2", targetResolution: "8K" })).toBe("topaz-image-upscale")
  })

  it("returns 'ideogram-v3:TURBO' for TURBO renderingSpeed", () => {
    expect(buildCreditModelIdentifier("ideogram-v3", { renderingSpeed: "TURBO" })).toBe("ideogram-v3:TURBO")
  })

  it("returns 'ideogram-v3:QUALITY' for QUALITY renderingSpeed", () => {
    expect(buildCreditModelIdentifier("ideogram-v3", { renderingSpeed: "QUALITY" })).toBe("ideogram-v3:QUALITY")
  })

  it("returns 'ideogram-v3' for BALANCED renderingSpeed (default, no suffix)", () => {
    expect(buildCreditModelIdentifier("ideogram-v3", { renderingSpeed: "BALANCED" })).toBe("ideogram-v3")
  })
})
