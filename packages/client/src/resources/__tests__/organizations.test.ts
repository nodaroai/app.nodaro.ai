import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, WORKSPACE_HEADER } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const WS = "20000000-0000-4000-8000-000000000001"
const WS2 = "20000000-0000-4000-8000-000000000002"

function client(fetchMock: ReturnType<typeof vi.fn>, workspaceId?: string) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
    ...(workspaceId ? { workspaceId } : {}),
  })
}

/** The headers of the Nth fetch, lower-cased so a caller's casing cannot hide. */
function headersOf(fetchMock: ReturnType<typeof vi.fn>, n = 0): Record<string, string> {
  const init = fetchMock.mock.calls[n][1] as { headers: Record<string, string> }
  return Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]))
}

/**
 * The header decides SCOPE, never ACCESS. That is what makes losing it
 * survivable and forging it useless — and it is why the SDK may send it on
 * every request without it being a security surface.
 */
describe("the workspace a client acts in", () => {
  it("sends no workspace header by default — the personal space", async () => {
    const f = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    await client(f).organizations.list()
    expect(headersOf(f)).not.toHaveProperty(WORKSPACE_HEADER.toLowerCase())
  })

  it("sends the configured workspace on every request", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: [] }))
    const c = client(f, WS)
    await c.organizations.list()
    await c.workspaces.list()
    expect(headersOf(f, 0)[WORKSPACE_HEADER.toLowerCase()]).toBe(WS)
    expect(headersOf(f, 1)[WORKSPACE_HEADER.toLowerCase()]).toBe(WS)
  })

  it("withWorkspace returns a NEW client and leaves the original alone", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: [] }))
    const base = client(f, WS)
    const other = base.withWorkspace(WS2)

    expect(other).not.toBe(base)
    expect(base.workspaceId).toBe(WS)
    expect(other.workspaceId).toBe(WS2)

    await base.organizations.list()
    await other.organizations.list()
    expect(headersOf(f, 0)[WORKSPACE_HEADER.toLowerCase()]).toBe(WS)
    expect(headersOf(f, 1)[WORKSPACE_HEADER.toLowerCase()]).toBe(WS2)
  })

  it("withWorkspace(null) goes back to the personal space", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: [] }))
    const personal = client(f, WS).withWorkspace(null)
    expect(personal.workspaceId).toBeUndefined()
    await personal.organizations.list()
    expect(headersOf(f)).not.toHaveProperty(WORKSPACE_HEADER.toLowerCase())
  })

  it("carries auth, baseUrl, timeout and the fetch override across", async () => {
    // A derived client that quietly lost the fetch override would hit the
    // network in tests, and one that lost auth would 401 in production.
    const f = vi.fn().mockReturnValue(mockOk({ data: [] }))
    const base = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("secret"),
      fetch: f as unknown as typeof fetch,
      timeoutMs: 1234,
    })
    const derived = base.withWorkspace(WS)
    expect(derived.baseUrl).toBe("https://api.example.com")
    expect(derived.timeoutMs).toBe(1234)
    await derived.organizations.list()
    expect(f).toHaveBeenCalledTimes(1)
    expect(headersOf(f)["authorization"]).toBe("Bearer secret")
  })

  it("lets a per-request header win, for the read that must reach outside", async () => {
    const f = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = client(f, WS)
    await c.request("GET", "/v1/anything", { headers: { [WORKSPACE_HEADER]: WS2 } })
    expect(headersOf(f)[WORKSPACE_HEADER.toLowerCase()]).toBe(WS2)
  })
})

describe("organizations resource", () => {
  it("creates, reads and updates at the documented paths", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: {} }))
    const c = client(f)
    await c.organizations.create({ name: "Kent High", kind: "school", acceptTerms: true })
    await c.organizations.get("org-1")
    await c.organizations.update("org-1", { name: "Kent High School" })

    expect(f.mock.calls[0][0]).toBe("https://api.example.com/v1/orgs")
    expect(f.mock.calls[0][1].method).toBe("POST")
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ kind: "school", acceptTerms: true })
    expect(f.mock.calls[1][0]).toBe("https://api.example.com/v1/orgs/org-1")
    expect(f.mock.calls[2][1].method).toBe("PATCH")
  })

  it("escapes ids rather than pasting them into a path", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: {} }))
    await client(f).organizations.removeMember("org/1", "user 2")
    expect(f.mock.calls[0][0]).toBe("https://api.example.com/v1/orgs/org%2F1/members/user%202")
  })

  it("passes paging through as query params", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: [], nextCursor: null }))
    await client(f).organizations.listInvitations("org-1", { status: "open", limit: 50 })
    expect(f.mock.calls[0][0]).toContain("status=open")
    expect(f.mock.calls[0][0]).toContain("limit=50")
  })

  it("returns invitation deliveries verbatim, link and all", async () => {
    // A link-only row is the normal case on an install with no mail provider.
    // The SDK must not flatten it away: without the link the invitation
    // exists and nobody can reach it.
    const f = vi.fn().mockReturnValueOnce(
      mockOk({ data: [{ email: "a@b.com", status: "link_only", link: "https://x/invite/tok" }] }),
    )
    const res = await client(f).organizations.invite("org-1", { emails: ["a@b.com"] })
    expect(res.data[0]).toEqual({ email: "a@b.com", status: "link_only", link: "https://x/invite/tok" })
  })
})

describe("workspaces resource", () => {
  it("archives and unarchives through distinct paths", async () => {
    const f = vi.fn().mockReturnValue(mockOk({ data: {} }))
    const c = client(f)
    await c.workspaces.setArchived("ws-1", true)
    await c.workspaces.setArchived("ws-1", false)
    expect(f.mock.calls[0][0]).toBe("https://api.example.com/v1/workspaces/ws-1/archive")
    expect(f.mock.calls[1][0]).toBe("https://api.example.com/v1/workspaces/ws-1/unarchive")
  })

  it("reads the identity list with its cursor-free envelope", async () => {
    const f = vi.fn().mockReturnValueOnce(mockOk({ data: [{ id: WS }], lastWorkspaceId: WS }))
    const res = await client(f).workspaces.list()
    expect(res.lastWorkspaceId).toBe(WS)
    expect(res.data).toHaveLength(1)
  })
})

describe("me()", () => {
  it("keeps the three organization states distinct", async () => {
    const absent = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "u", email: "e" } }))
    expect(await client(absent).me()).not.toHaveProperty("organizations")

    const none = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "u", organizations: [], workspaces: [] } }))
    expect((await client(none).me()).organizations).toEqual([])

    const broken = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "u", organizationsUnavailable: true } }))
    const res = await client(broken).me()
    expect(res.organizationsUnavailable).toBe(true)
    expect(res.organizations).toBeUndefined()
  })
})
