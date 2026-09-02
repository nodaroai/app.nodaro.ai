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
import { sunoCreditType, SUNO_SELECT_OPERATIONS, SUNO_MODELS } from "@nodaro/shared"
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

  it("motion-graphics defaults to the elements feature", () => {
    const node = makeNode({ type: "motion-graphics", data: { label: "MG" } as any })
    expect(getModelIdentifier(node)).toBe("motion-graphics")
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
  // node carries (all four flat-priced Suno nodes default to model V5_5).
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
