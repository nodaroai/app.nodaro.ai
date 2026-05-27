import { describe, it, expect, beforeEach, vi } from "vitest"

// Stub localStorage for jsdom (which exposes a non-mockable native impl)
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
  clear: vi.fn(() => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]) }),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true })

import {
  readMemory,
  rememberSelection,
  clearMemory,
  resolveNodeDefaults,
  pickRelevantFields,
  type AdminDefault,
} from "../node-defaults"

beforeEach(() => {
  Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
})

describe("user memory store", () => {
  it("round-trips a snapshot", () => {
    rememberSelection("user-1", "generate-image", { provider: "flux", model: "flux-1.1-pro" })
    expect(readMemory("user-1")).toEqual({
      "generate-image": { provider: "flux", model: "flux-1.1-pro" },
    })
  })

  it("isolates memory per user", () => {
    rememberSelection("user-a", "generate-image", { provider: "flux" })
    rememberSelection("user-b", "generate-image", { provider: "nano-banana-pro" })
    expect(readMemory("user-a")["generate-image"]).toEqual({ provider: "flux" })
    expect(readMemory("user-b")["generate-image"]).toEqual({ provider: "nano-banana-pro" })
  })

  it("clearMemory wipes a user's snapshots", () => {
    rememberSelection("u1", "generate-image", { provider: "flux" })
    rememberSelection("u1", "text-to-video", { provider: "kling" })
    clearMemory("u1")
    expect(readMemory("u1")).toEqual({})
  })

  it("readMemory returns {} for unknown user", () => {
    expect(readMemory("never-seen-user")).toEqual({})
  })

  it("readMemory tolerates corrupt JSON", () => {
    localStorageStore["nodaro:nodeMemory:v1:u1"] = "{not-json"
    expect(readMemory("u1")).toEqual({})
  })
})

describe("pickRelevantFields", () => {
  it("picks the configured fields for generate-image", () => {
    expect(
      pickRelevantFields("generate-image", {
        provider: "flux",
        model: "flux-1.1-pro",
        prompt: "a cat",
        aspectRatio: "16:9",
        unrelated: "noise",
      }),
    ).toEqual({
      provider: "flux",
      model: "flux-1.1-pro",
      aspectRatio: "16:9",
    })
  })

  it("picks provider+aspectRatio+duration+resolution for generate-video (unified node)", () => {
    expect(
      pickRelevantFields("generate-video", {
        provider: "kling",
        aspectRatio: "9:16",
        duration: 5,
        resolution: "1080p",
        prompt: "ignored",
        model: "ignored-not-in-list",
      }),
    ).toEqual({
      provider: "kling",
      aspectRatio: "9:16",
      duration: 5,
      resolution: "1080p",
    })
  })

  it("falls back to provider+model for unknown node types", () => {
    expect(pickRelevantFields("not-in-registry", { provider: "x", model: "y", other: "z" })).toEqual({
      provider: "x",
      model: "y",
    })
  })
})

describe("resolveNodeDefaults", () => {
  it("returns factory unchanged for non-node-default types", () => {
    const out = resolveNodeDefaults({
      nodeType: "text-prompt",
      factory: { text: "hello" },
      adminDefaults: [],
    })
    expect(out).toEqual({ text: "hello" })
  })

  it("returns factory when no admin/user layer", () => {
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory: { provider: "nano-banana-pro", model: "gemini-2.5-flash-image" },
      adminDefaults: [],
    })
    expect(out.provider).toBe("nano-banana-pro")
  })

  it("admin overrides factory and applies semantic mappings", () => {
    const admin: AdminDefault[] = [
      { node_type: "generate-image", provider: "nano-banana-pro", quality_level: "high", aspect_ratio: "16:9" },
    ]
    const factory: Record<string, unknown> = { provider: "flux", model: "x" }
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory,
      adminDefaults: admin,
    })
    expect(out.provider).toBe("nano-banana-pro")
    expect(out.model).toBe("gemini-2.5-flash-image")
    expect(out.resolution).toBe("4K")
    expect(out.aspectRatio).toBe("16:9")
    // Regression: must NOT also pollute `quality` with "4K" — that trips
    // the route's quality enum (medium|high|basic) when the user runs the node.
    expect(out.quality).toBeUndefined()
  })

  it("quality-style providers (gpt-image) write quality, not resolution", () => {
    const admin: AdminDefault[] = [
      { node_type: "generate-image", provider: "gpt-image", quality_level: "mid", aspect_ratio: null },
    ]
    const factory: Record<string, unknown> = { provider: "flux" }
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory,
      adminDefaults: admin,
    })
    expect(out.provider).toBe("gpt-image")
    expect(out.quality).toBe("medium")
    // Regression: must NOT also pollute `resolution` with "medium" — that trips
    // the route's resolution enum (1K|2K|4K).
    expect(out.resolution).toBeUndefined()
  })

  it("user memory overrides admin", () => {
    rememberSelection("u1", "generate-image", { provider: "flux", model: "flux-1.1-pro" })
    const admin: AdminDefault[] = [
      { node_type: "generate-image", provider: "nano-banana-pro", quality_level: "mid", aspect_ratio: null },
    ]
    const factory: Record<string, unknown> = { provider: "nano-banana-pro" }
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory,
      adminDefaults: admin,
      userId: "u1",
    })
    expect(out.provider).toBe("flux")
    expect(out.model).toBe("flux-1.1-pro")
  })

  it("drops stale user memory whose provider was removed", () => {
    rememberSelection("u1", "generate-image", { provider: "removed-provider" })
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory: { provider: "nano-banana-pro" },
      adminDefaults: [],
      userId: "u1",
    })
    expect(out.provider).toBe("nano-banana-pro")
  })

  it("LLM nodes use model field", () => {
    const admin: AdminDefault[] = [
      { node_type: "ai-writer", provider: "claude-opus-4.6", quality_level: null, aspect_ratio: null },
    ]
    const factory: Record<string, unknown> = { model: "claude-sonnet-4.6" }
    const out = resolveNodeDefaults({
      nodeType: "ai-writer",
      factory,
      adminDefaults: admin,
    })
    expect(out.model).toBe("claude-opus-4.6")
  })

  it("auto aspect ratio is omitted (does not set the field)", () => {
    const admin: AdminDefault[] = [
      { node_type: "generate-image", provider: "nano-banana-pro", quality_level: null, aspect_ratio: "auto" },
    ]
    const out = resolveNodeDefaults({
      nodeType: "generate-image",
      factory: { provider: "x", aspectRatio: "1:1" },
      adminDefaults: admin,
    })
    // aspectRatio retains factory value because mapAspectRatio("…","auto") returns undefined
    expect(out.aspectRatio).toBe("1:1")
  })
})
