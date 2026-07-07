import { describe, it, expect } from "vitest"
import {
  getPipelinePrompt,
  registerPipelinePrompts,
  pipelinePromptsAvailable,
  PipelinePromptUnavailableError,
  PIPELINE_PROMPT_KEYS,
  __resetPipelinePromptRegistryForTests,
} from "../prompt-registry.js"

// Each test manages its own registry state (reset then register exactly what
// it needs) so tests are order-independent WITHIN this file. No cross-file
// cleanup is needed: Vitest isolates each test FILE's module registry by
// default, so resetting/repopulating the registry here never leaks into
// other test files — each of those gets its own fresh run of
// backend/src/test/setup.ts (which registers the real S9 fixture) before its
// own tests execute.

describe("prompt-registry", () => {
  it("registerPipelinePrompts + getPipelinePrompt round-trips a value", () => {
    __resetPipelinePromptRegistryForTests()
    registerPipelinePrompts({ "some.key": "some value" })
    expect(getPipelinePrompt("some.key")).toBe("some value")
  })

  it("getPipelinePrompt throws PipelinePromptUnavailableError when the key is absent", () => {
    __resetPipelinePromptRegistryForTests()
    expect(() => getPipelinePrompt("missing.key")).toThrow(PipelinePromptUnavailableError)
    expect(() => getPipelinePrompt("missing.key")).toThrow(/missing\.key/)
    expect(() => getPipelinePrompt("missing.key")).toThrow(/unavailable/i)
  })

  it("PipelinePromptUnavailableError exposes the offending key", () => {
    __resetPipelinePromptRegistryForTests()
    try {
      getPipelinePrompt("some.other.key")
      expect.unreachable("expected getPipelinePrompt to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(PipelinePromptUnavailableError)
      expect((err as PipelinePromptUnavailableError).key).toBe("some.other.key")
    }
  })

  it("registerPipelinePrompts merges additively — last write wins per key", () => {
    __resetPipelinePromptRegistryForTests()
    registerPipelinePrompts({ a: "1", b: "2" })
    registerPipelinePrompts({ b: "2-updated", c: "3" })
    expect(getPipelinePrompt("a")).toBe("1")
    expect(getPipelinePrompt("b")).toBe("2-updated")
    expect(getPipelinePrompt("c")).toBe("3")
  })

  it("pipelinePromptsAvailable() is false on an empty registry, true once anything is registered", () => {
    __resetPipelinePromptRegistryForTests()
    expect(pipelinePromptsAvailable()).toBe(false)
    registerPipelinePrompts({ "x.y": "z" })
    expect(pipelinePromptsAvailable()).toBe(true)
  })

  it("__resetPipelinePromptRegistryForTests clears every registered key", () => {
    registerPipelinePrompts({ "x.y": "z" })
    expect(pipelinePromptsAvailable()).toBe(true)
    __resetPipelinePromptRegistryForTests()
    expect(pipelinePromptsAvailable()).toBe(false)
  })

  it("PIPELINE_PROMPT_KEYS has exactly 25 unique-valued entries", () => {
    const entries = Object.entries(PIPELINE_PROMPT_KEYS)
    expect(entries).toHaveLength(25)
    const values = entries.map(([, v]) => v)
    expect(new Set(values).size).toBe(25)
  })
})
