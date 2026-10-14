import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { continueUseCase, tightenEpisode } from "../api"

/**
 * Tighten Episode's client: the run and the continue each carry the call's
 * Idempotency-Key (the server hands a keyed retry its run back, one run and
 * one fee), and the continue keeps the job a 409 names beside `error`.
 */
function mockFetch(status: number, data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

const headersOf = (f: ReturnType<typeof mockFetch>) => (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>
const bodyOf = (f: ReturnType<typeof mockFetch>) => JSON.parse((f.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("tightenEpisode", () => {
  it("sends the recording as mediaUrls and the call's Idempotency-Key", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await expect(tightenEpisode({ mediaUrl: "https://r2/ep.mp4", captions: false }, "click-1:iter:2")).resolves.toEqual({ jobId: "job-1" })
    expect(headersOf(f)["Idempotency-Key"]).toBe("click-1:iter:2")
    expect(bodyOf(f)).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"], captions: false })
  })

  it("sends no key when the call has none", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await tightenEpisode({ mediaUrl: "https://r2/ep.mp4" })
    expect(headersOf(f)["Idempotency-Key"]).toBeUndefined()
  })
})

describe("continueUseCase", () => {
  it("sends the Idempotency-Key and the node, and answers started", async () => {
    const f = mockFetch(202, { jobId: "job-2", executionId: "exec-2" })
    vi.stubGlobal("fetch", f)
    await expect(continueUseCase({ jobId: "00000000-0000-4000-8000-000000000000", mode: "from-failed", nodeId: "t1" }, "click-2")).resolves.toEqual({ kind: "started", jobId: "job-2" })
    expect(headersOf(f)["Idempotency-Key"]).toBe("click-2")
    expect(bodyOf(f)).toMatchObject({ mode: "from-failed", nodeId: "t1" })
  })

  it("keeps the job a 409 names: already running, superseded; and reads settling", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "already_running", message: "under way" }, jobId: "job-live" }))
    await expect(continueUseCase({ jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "running", jobId: "job-live" })
    // A Render final refused (a final under way, or this very edit already rendered) fails, naming that final.
    for (const code of ["render_final_already_rendered", "already_running"]) {
      vi.stubGlobal("fetch", mockFetch(409, { error: { code, message: "refused" }, jobId: "job-f" }))
      await expect(continueUseCase({ jobId: "j", mode: "render-final" })).rejects.toMatchObject({ code, jobId: "job-f" })
    }
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_superseded", message: "newer" }, jobId: "job-new" }))
    await expect(continueUseCase({ jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "superseded", jobId: "job-new", message: "newer" })
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_settling", message: "wait" } }))
    await expect(continueUseCase({ jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "settling", message: "wait" })
  })

  it("throws any other refusal with its code", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_not_failed", message: "did not fail" } }))
    await expect(continueUseCase({ jobId: "j", mode: "from-failed" })).rejects.toMatchObject({ code: "continuation_not_failed" })
  })
})
