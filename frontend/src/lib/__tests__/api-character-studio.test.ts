import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client (api.ts imports createClient from @/lib/supabase via
// getAuthHeaders()).
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { llmSuggestDescription } from "../api"

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("llmSuggestDescription", () => {
  it("POSTs to /v1/llm-suggest-description with the body and returns { text }", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: "warm closed-mouth smile" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await llmSuggestDescription({
      kind: "asset-description",
      context: { assetType: "expressions", variant: "smile" },
    })

    expect(result).toEqual({ text: "warm closed-mouth smile" })
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/llm-suggest-description",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          kind: "asset-description",
          context: { assetType: "expressions", variant: "smile" },
        }),
      }),
    )
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("throws a typed Error with the backend message on 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "validation_error", message: "Invalid kind" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      llmSuggestDescription({ kind: "seed-prompt", context: {} }),
    ).rejects.toThrow(/Invalid kind/)
  })
})
