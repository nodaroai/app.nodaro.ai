import { describe, it, expect } from "vitest"
import { EXECUTION_DATA_KEYS } from "../node-runtime-keys.js"
import { extractPresetData, PRESET_EXCLUDED_KEYS } from "../node-preset-extract.js"

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

  it("PRESET_EXCLUDED_KEYS contains label and fieldMappings", () => {
    expect(PRESET_EXCLUDED_KEYS.has("label")).toBe(true)
    expect(PRESET_EXCLUDED_KEYS.has("fieldMappings")).toBe(true)
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
})
