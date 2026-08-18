import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

const mockHasCredits = vi.fn(() => false)
vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

import { useLlmAvailability, _resetLlmAvailabilityCacheForTests } from "../use-llm-availability"

const originalFetch = globalThis.fetch

function mockStatus(llm: boolean) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ checks: { providers: { llm } } }),
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHasCredits.mockReturnValue(false)
  _resetLlmAvailabilityCacheForTests()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("useLlmAvailability (#752)", () => {
  it("true on Cloud without ever fetching — billing editions carry the platform keys", () => {
    mockHasCredits.mockReturnValue(true)
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    const { result } = renderHook(() => useLlmAvailability())
    expect(result.current).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it("true on a self-host install once /v1/setup/status reports an LLM lane", async () => {
    mockStatus(true)
    const { result } = renderHook(() => useLlmAvailability())
    expect(result.current).toBe(false) // conservative while loading
    await waitFor(() => expect(result.current).toBe(true))
    expect(globalThis.fetch).toHaveBeenCalledWith("/v1/setup/status")
  })

  it("false when the install has no LLM lane", async () => {
    mockStatus(false)
    const { result } = renderHook(() => useLlmAvailability())
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it("false when the status endpoint is unreachable — hidden beats a dead button", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch
    const { result } = renderHook(() => useLlmAvailability())
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it("caches within the TTL — sixteen buttons, one request", async () => {
    mockStatus(true)
    const a = renderHook(() => useLlmAvailability())
    const b = renderHook(() => useLlmAvailability())
    await waitFor(() => expect(a.result.current).toBe(true))
    await waitFor(() => expect(b.result.current).toBe(true))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
