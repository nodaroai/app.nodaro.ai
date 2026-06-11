import { describe, it, expect } from "vitest"
import { EXECUTION_DATA_KEYS } from "../node-runtime-keys.js"
import {
  extractPresetData,
  PRESET_EXCLUDED_KEYS,
  PRESET_APPLY_CLEAR_KEYS,
  presetDataMatches,
} from "../node-preset-extract.js"

describe("EXECUTION_DATA_KEYS", () => {
  it("is non-empty and contains known result keys", () => {
    expect(EXECUTION_DATA_KEYS.size).toBeGreaterThan(20)
    for (const k of ["generatedResults", "currentJobId", "executionStatus", "activeResultIndex"]) {
      expect(EXECUTION_DATA_KEYS.has(k)).toBe(true)
    }
  })
})

describe("extractPresetData", () => {
  it("keeps config fields, drops runtime + label + fieldMappings", () => {
    const out = extractPresetData({
      label: "My Node",
      prompt: "a cat",
      provider: "nano-banana",
      aspectRatio: "16:9",
      negativePrompt: "",
      seed: 0,
      expandPrompt: false,
      fieldMappings: { prompt: "node_3" },
      generatedResults: [{ url: "x" }],
      currentJobId: "job_1",
      executionStatus: "completed",
      activeResultIndex: 2,
    })
    expect(out).toEqual({
      prompt: "a cat",
      provider: "nano-banana",
      aspectRatio: "16:9",
      negativePrompt: "",
      seed: 0,
      expandPrompt: false,
    })
  })

  it("preserves empty/false/zero values so apply reproduces saved state", () => {
    const out = extractPresetData({ a: "", b: false, c: 0, d: null })
    expect(out).toEqual({ a: "", b: false, c: 0, d: null })
  })

  it("excludes every EXECUTION_DATA_KEYS member", () => {
    const input: Record<string, unknown> = { keep: 1 }
    for (const k of EXECUTION_DATA_KEYS) input[k] = "runtime"
    const out = extractPresetData(input)
    expect(out).toEqual({ keep: 1 })
  })

  it("does not mutate its input", () => {
    const input = { prompt: "x", label: "y" }
    extractPresetData(input)
    expect(input).toEqual({ prompt: "x", label: "y" })
  })

  it("PRESET_EXCLUDED_KEYS contains label, fieldMappings, and __activePresetId", () => {
    expect(PRESET_EXCLUDED_KEYS.has("label")).toBe(true)
    expect(PRESET_EXCLUDED_KEYS.has("fieldMappings")).toBe(true)
    expect(PRESET_EXCLUDED_KEYS.has("__activePresetId")).toBe(true)
  })

  it("drops graph-topology + DB-reference fields but keeps manual reference urls", () => {
    const out = extractPresetData({
      prompt: "a",
      // manual, self-contained inputs — KEEP
      referenceImageUrl: "https://r2/x.png",
      referenceImageUrls: [{ id: "t1", url: "https://r2/y.png" }],
      // graph wiring / DB references / identity — DROP
      referenceImageOrder: ["t1"],
      referenceOrder: ["t1"],
      connectedMediaOrder: ["n2"],
      connectedRefImageOrder: ["n3"],
      characterDefinitionIds: ["char-1"],
      suppressedCanonicalCharacterIds: ["char-2"],
      suppressedCanonicalLocationIds: ["loc-1"],
      identityMeta: [{ imageIndex: 0, label: "x" }],
      extraRefs: [{ url: "https://r2/z.png", characterSlug: "@bob" }],
    })
    expect(out).toEqual({
      prompt: "a",
      referenceImageUrl: "https://r2/x.png",
      referenceImageUrls: [{ id: "t1", url: "https://r2/y.png" }],
    })
  })

  it("drops structural identifiers (router routes, sub-workflow ports, teleport channel)", () => {
    const out = extractPresetData({
      mode: "radio", // router non-structural config — KEEP
      routes: [{ id: "default_a", name: "Route A", active: true }],
      routeId: "r1",
      routeIds: ["r1", "r2"],
      ports: [{ id: "p1", name: "Input", mediaType: "any" }],
      inputPorts: [{ id: "p2" }],
      outputPorts: [{ id: "p3" }],
      channel: "A",
      channelColor: "#f59e0b",
    })
    expect(out).toEqual({ mode: "radio" })
  })

  it("drops generated composer-plan state (motionPlan + lottieUrl) but keeps the prompt", () => {
    const out = extractPresetData({
      motionPrompt: "x",
      engine: "lottie",
      motionPlan: { layers: [{ ind: 1 }], slots: {} },
      lottieUrl: "https://r2.example/lottie/abc.json",
    })
    expect(out).toEqual({ motionPrompt: "x", engine: "lottie" })
  })

  it("excludes every generated composer-plan field for all composer node types", () => {
    const input: Record<string, unknown> = { keep: 1 }
    // every plan field (sceneGraph/effectPlan/overlayPlan/titlePlan/motionPlan/compositePlan) + lottieUrl
    for (const k of PRESET_APPLY_CLEAR_KEYS) input[k] = "generated"
    expect(extractPresetData(input)).toEqual({ keep: 1 })
  })
})

describe("PRESET_EXCLUDED_KEYS ⊇ PRESET_APPLY_CLEAR_KEYS", () => {
  it("every clear-on-apply key is also capture-excluded (one source covers save + import + override)", () => {
    for (const k of PRESET_APPLY_CLEAR_KEYS) {
      expect(PRESET_EXCLUDED_KEYS.has(k), `${k} must be capture-excluded`).toBe(true)
    }
  })
})

describe("presetDataMatches", () => {
  it("true when every preset key matches the node value (extra node keys ignored)", () => {
    expect(
      presetDataMatches(
        { prompt: "a", provider: "flux", seed: 5, __activePresetId: "x" },
        { prompt: "a", provider: "flux" },
      ),
    ).toBe(true)
  })

  it("false when a preset-defined key differs", () => {
    expect(presetDataMatches({ prompt: "b", provider: "flux" }, { prompt: "a", provider: "flux" })).toBe(false)
  })

  it("false when a preset key is missing on the node", () => {
    expect(presetDataMatches({ prompt: "a" }, { prompt: "a", provider: "flux" })).toBe(false)
  })

  it("deep-compares nested arrays/objects", () => {
    expect(presetDataMatches({ refs: [{ url: "u" }] }, { refs: [{ url: "u" }] })).toBe(true)
    expect(presetDataMatches({ refs: [{ url: "u" }] }, { refs: [{ url: "v" }] })).toBe(false)
  })

  it("empty preset data matches anything", () => {
    expect(presetDataMatches({ prompt: "a" }, {})).toBe(true)
  })
})
