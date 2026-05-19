import { describe, it, expect } from "vitest"
import { PROVIDER_KIND_VALUES, STALE_THRESHOLD_MS, isAsyncKind, isSyncKind } from "../types.js"

describe("ProviderKind registry", () => {
  it("exposes all 14 spec-listed kinds at runtime", () => {
    expect(PROVIDER_KIND_VALUES).toEqual([
      "kie-standard", "kie-veo", "kie-suno", "kie-kontext", "kie-luma",
      "kie-kling3", "kie-runway", "kie-lip-sync", "kie-llm",
      "replicate-prediction", "replicate-training",
      "elevenlabs-async", "elevenlabs-sync", "anthropic-sync",
    ])
  })

  it("has a stale-threshold for every kind", () => {
    for (const kind of PROVIDER_KIND_VALUES) {
      expect(STALE_THRESHOLD_MS[kind]).toBeGreaterThan(0)
    }
  })

  it("marks sync kinds correctly", () => {
    expect(isSyncKind("kie-llm")).toBe(true)
    expect(isSyncKind("elevenlabs-sync")).toBe(true)
    expect(isSyncKind("anthropic-sync")).toBe(true)
    expect(isSyncKind("kie-standard")).toBe(false)
    expect(isSyncKind("replicate-prediction")).toBe(false)
  })

  it("isAsyncKind is the inverse of isSyncKind for all values", () => {
    for (const kind of PROVIDER_KIND_VALUES) {
      expect(isAsyncKind(kind)).toBe(!isSyncKind(kind))
    }
  })
})
