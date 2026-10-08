/**
 * Lane-fallback observability — a swallowed primary-lane error must WARN.
 *
 * Incident 2026-08-14: two direct-Gemini calls got a transient Google
 * `403 PERMISSION_DENIED` (video-analysis job bdbed2c6). The pinned calls
 * surfaced it, but every UNPINNED preferDirect call would have been served
 * silently from the KIE lane by `withFallback`'s bare `catch {}` — so a
 * chronic direct-lane outage (which also flips traffic onto the wrong-cost
 * lane) was invisible in logs. These tests pin the `[llm-lane-fallback]`
 * warn line for both fallback directions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    GEMINI_API_KEY: "test-gemini-key",
    ANTHROPIC_API_KEY: "",
    NODE_ENV: "test",
  },
}))

const geminiMock = vi.hoisted(() => ({
  callGeminiDirect: vi.fn(),
  streamGeminiDirect: vi.fn(),
}))
vi.mock("../gemini/client.js", () => geminiMock)

function kieChatOk(text = "kie-served"): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

describe("withFallback lane logging", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    geminiMock.callGeminiDirect.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
  })

  // The direct-PRIMARY direction (a Claude call with an effort, served direct
  // with KIE as the fallback) is pinned in llm-client-routing.test.ts — no
  // model is direct-first unpinned any more (decided 2026-10-08), so this file,
  // which mocks the Gemini lane, keeps the KIE-primary direction.

  it("KIE-first model: KIE failure served by direct lane is warn-logged too", async () => {
    const { llmComplete } = await import("../llm-client.js")
    geminiMock.callGeminiDirect.mockResolvedValue({
      text: "direct-served",
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "gemini-3.6-flash",
    })
    fetchMock.mockRejectedValue(new Error("socket hang up"))

    const res = await llmComplete({
      modelId: "gemini-3.6-flash",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })

    expect(res.text).toBe("direct-served")
    const fallbackWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[llm-lane-fallback]"))
    expect(fallbackWarns).toHaveLength(1)
    expect(String(fallbackWarns[0]![0])).toContain("gemini-3.6-flash")
  })

  it("no warn when the primary lane succeeds", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieChatOk("kie-ok"))

    const res = await llmComplete({
      modelId: "gemini-3.1-pro",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })

    expect(res.text).toBe("kie-ok")
    expect(geminiMock.callGeminiDirect).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[llm-lane-fallback]"))).toHaveLength(0)
  })
})
