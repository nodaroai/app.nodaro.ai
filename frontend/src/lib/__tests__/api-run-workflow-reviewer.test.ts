import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The editor marks its own runs as reviewed (`reviewer: "editor"`). A session
 * JWT alone is not a reviewer — the SDK's supabaseAuth and the thin product
 * clients send one too — so without the mark the server refuses a Preview
 * render with `preview_review_required` (decided 2026-10-04).
 */

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { runWorkflow } from "../api"

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 202,
    json: () => Promise.resolve({ executionId: "exec-1" }),
  })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("runWorkflow marks the run as the editor's", () => {
  it("a full run sends the mark", async () => {
    const fetchMock = okFetch()
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1")
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ reviewer: "editor" })
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  it("a partial run sends the mark beside its node ids", async () => {
    const fetchMock = okFetch()
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1", ["a", "b"])
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ nodeIds: ["a", "b"], reviewer: "editor" })
  })

  it("sends the nested input overrides beside the ids, and the mark (Render final's final override)", async () => {
    const fetchMock = okFetch()
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1", ["r"], "key-1", { inputOverrides: { r: { quality: "final" } } })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      nodeIds: ["r"],
      inputOverrides: { r: { quality: "final" } },
      reviewer: "editor",
    })
  })

  it("an empty override map is not sent", async () => {
    const fetchMock = okFetch()
    vi.stubGlobal("fetch", fetchMock)
    await runWorkflow("wf-1", ["r"], undefined, { inputOverrides: {} })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ nodeIds: ["r"], reviewer: "editor" })
  })
})
