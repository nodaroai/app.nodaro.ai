import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client (auth headers helper reads the session token)
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { pipelinesApi } from "../pipelines-api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  sessionWith("test-token")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Phase 3 — Character Wizard Step A
// ---------------------------------------------------------------------------

describe("pipelinesApi.approveDescription", () => {
  it("mode='llm' POSTs with just the mode field", async () => {
    const fetchMock = mockFetchJson({ ok: true, newStatus: "pending" })
    vi.stubGlobal("fetch", fetchMock)

    const res = await pipelinesApi.approveDescription("p1", "e-hero", {
      mode: "llm",
    })

    expect(res).toEqual({ ok: true, newStatus: "pending" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/v1/pipelines/p1/entities/e-hero/approve-description")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ mode: "llm" })
    // Authorization header carries the supabase token.
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer test-token")
  })

  it("mode='user_edited' POSTs the rewritten description", async () => {
    const fetchMock = mockFetchJson({ ok: true, newStatus: "pending" })
    vi.stubGlobal("fetch", fetchMock)

    await pipelinesApi.approveDescription("p1", "e-hero", {
      mode: "user_edited",
      description: "A grizzled, weathered desert ranger.",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "user_edited",
      description: "A grizzled, weathered desert ranger.",
    })
  })

  it("mode='upload' POSTs the asset url with optional metadata", async () => {
    const fetchMock = mockFetchJson({
      ok: true,
      newStatus: "approved",
      assetId: "asset-uuid",
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await pipelinesApi.approveDescription("p1", "e-hero", {
      mode: "upload",
      asset_url: "https://r2.example.com/uploads/abc.jpg",
      filename: "hero-portrait.jpg",
      mime_type: "image/jpeg",
      size_bytes: 102_400,
    })

    expect(res.assetId).toBe("asset-uuid")
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "upload",
      asset_url: "https://r2.example.com/uploads/abc.jpg",
      filename: "hero-portrait.jpg",
      mime_type: "image/jpeg",
      size_bytes: 102_400,
    })
  })

  it("rejects with backend error message when CAS race loses (409)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({ error: "entity_not_pending_description" }),
      text: () => Promise.resolve(`{"error":"entity_not_pending_description"}`),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      pipelinesApi.approveDescription("p1", "e-hero", { mode: "llm" }),
    ).rejects.toThrow(/entity_not_pending_description/)
  })
})

describe("pipelinesApi.skipEntity", () => {
  it("POSTs an empty body to the skip route", async () => {
    const fetchMock = mockFetchJson({ ok: true })
    vi.stubGlobal("fetch", fetchMock)

    const res = await pipelinesApi.skipEntity("p1", "e-hero")

    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/v1/pipelines/p1/entities/e-hero/skip")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({})
  })

  it("rejects with backend error when entity is no longer pending_description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({ error: "entity_not_pending_description" }),
      text: () => Promise.resolve(`{"error":"entity_not_pending_description"}`),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(pipelinesApi.skipEntity("p1", "e-hero")).rejects.toThrow(
      /entity_not_pending_description/,
    )
  })
})
