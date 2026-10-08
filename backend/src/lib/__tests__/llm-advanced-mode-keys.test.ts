/**
 * Advanced mode on an install with no key for the model's direct lane is
 * refused up front (400, before any credit reservation) — a self-hosted install
 * with no ANTHROPIC_API_KEY used to accept it and fail inside the call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const configMock = vi.hoisted(() => ({ ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", NODE_ENV: "test" }))
vi.mock("../config.js", () => ({ config: configMock }))

describe("advancedModeError — the direct lane's key", () => {
  beforeEach(() => {
    configMock.ANTHROPIC_API_KEY = ""
    configMock.GEMINI_API_KEY = ""
  })

  it("refuses Claude Advanced with no ANTHROPIC_API_KEY, and Gemini with no GEMINI_API_KEY", async () => {
    const { advancedModeError } = await import("../llm-advanced-mode.js")
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5")?.code).toBe("advanced_mode_unavailable")
    expect(advancedModeError({ advancedMode: true }, "gemini-3.6-flash")?.code).toBe("advanced_mode_unavailable")
  })

  it("accepts each once its own key is set — and the other key does not count", async () => {
    const { advancedModeError } = await import("../llm-advanced-mode.js")
    configMock.ANTHROPIC_API_KEY = "sk-ant"
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5")).toBeNull()
    expect(advancedModeError({ advancedMode: true }, "gemini-3.6-flash")?.code).toBe("advanced_mode_unavailable")
    configMock.GEMINI_API_KEY = "g"
    expect(advancedModeError({ advancedMode: true }, "gemini-3.6-flash")).toBeNull()
  })

  it("a model with no direct lane is still `advanced_mode_unsupported`, and Advanced off is never an error", async () => {
    const { advancedModeError } = await import("../llm-advanced-mode.js")
    expect(advancedModeError({ advancedMode: true }, "kimi-k3")?.code).toBe("advanced_mode_unsupported")
    expect(advancedModeError({}, "claude-opus-5.5")).toBeNull()
  })
})
