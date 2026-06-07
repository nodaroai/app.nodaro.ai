import { describe, it, expect } from "vitest"
import { PROVIDER_KIND_VALUES, STALE_THRESHOLD_MS, isAsyncKind, isSyncKind } from "../types.js"

describe("ProviderKind registry", () => {
  it("exposes spec-listed kinds at runtime (14 base + 2 suno-voice in P5.2 + 3 reconcile blind-spot fixes + heygen stall-retry guard)", () => {
    expect(PROVIDER_KIND_VALUES).toEqual([
      "kie-standard", "kie-veo", "kie-veo-1080p", "kie-suno",
      "kie-suno-voice-create", "kie-suno-voice-validate",
      "kie-kontext", "kie-luma",
      "kie-kling3", "kie-runway", "kie-aleph", "kie-lip-sync", "kie-llm",
      "replicate-prediction", "replicate-training",
      "elevenlabs-async", "elevenlabs-sync", "anthropic-sync",
      "heygen",
      "pre-task",
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
    expect(isSyncKind("kie-suno-voice-create")).toBe(true)
    expect(isSyncKind("kie-suno-voice-validate")).toBe(true)
    expect(isSyncKind("pre-task")).toBe(true)
    expect(isSyncKind("heygen")).toBe(true)
    expect(isSyncKind("kie-standard")).toBe(false)
    expect(isSyncKind("kie-aleph")).toBe(false)
    expect(isSyncKind("kie-veo-1080p")).toBe(false)
    expect(isSyncKind("replicate-prediction")).toBe(false)
  })

  it("isAsyncKind is the inverse of isSyncKind for all values", () => {
    for (const kind of PROVIDER_KIND_VALUES) {
      expect(isAsyncKind(kind)).toBe(!isSyncKind(kind))
    }
  })
})
