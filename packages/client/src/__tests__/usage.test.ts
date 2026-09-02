import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, ForbiddenError, USAGE_GROUP_BYS } from "../index.js"
// WIRE-01: every type in a public method signature is re-exported from @nodaro/sdk.
import type { UsageReport, UsageLogEntry, UsageQuery, UsageGroupBy } from "../index.js"

it("re-exports the usage wire types and vocabulary from the SDK index", () => {
  // Type-level: these compile only if the re-exports exist.
  const _q: UsageQuery = { groupBy: "day" satisfies UsageGroupBy }
  const _r: Pick<UsageReport, "truncated"> = { truncated: false }
  const _e: Pick<UsageLogEntry, "isAppRun"> = { isAppRun: false }
  void _q
  void _r
  void _e
  expect(USAGE_GROUP_BYS).toContain("none")
})

function mockJson<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockText(text: string) {
  return Promise.resolve({ ok: true, status: 200, text: async () => text } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}
function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

describe("organizations.usage", () => {
  it("builds the report URL with the query params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockJson({ data: { rows: [] } }))
    await client(fetchMock).organizations.usage("org_1", {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "Asia/Jerusalem",
      groupBy: "member",
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/orgs/org_1/usage")
    expect(url).toContain("from=2026-09-01")
    expect(url).toContain("to=2026-09-30")
    expect(url).toContain("tz=Asia%2FJerusalem")
    expect(url).toContain("groupBy=member")
  })

  it("usageRows forces groupBy=none", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockJson({ data: [], nextCursor: null }))
    await client(fetchMock).organizations.usageRows("org_1", { limit: 25 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("groupBy=none")
    expect(url).toContain("limit=25")
  })

  it("usageCsv sends format=csv and returns raw text", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockText("group,runs,credits\r\ntotal,1,5\r\n"))
    const csv = await client(fetchMock).organizations.usageCsv("org_1", { groupBy: "day" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/orgs/org_1/usage")
    expect(url).toContain("format=csv")
    expect(csv).toBe("group,runs,credits\r\ntotal,1,5\r\n")
  })

  it("a 403 envelope throws ForbiddenError, never InsufficientCreditsError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(403, { error: { code: "insufficient_role", message: "nope" } }))
    await expect(client(fetchMock).organizations.usage("org_1")).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("workspaces.usage", () => {
  it("builds the workspace report URL", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockJson({ data: { rows: [] } }))
    await client(fetchMock).workspaces.usage("ws_1", { groupBy: "day" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/workspaces/ws_1/usage")
    expect(url).toContain("groupBy=day")
  })

  it("workspaces.usageCsv returns text with format=csv", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockText("id,credits\r\n"))
    const csv = await client(fetchMock).workspaces.usageCsv("ws_1")
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/workspaces/ws_1/usage")
    expect(url).toContain("format=csv")
    expect(csv).toBe("id,credits\r\n")
  })
})

describe("timeout bounds the body read (send reads inside the abort timer)", () => {
  it("aborts a stalled CSV body at timeoutMs instead of hanging", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return {
        ok: true,
        status: 200,
        // A body read that never resolves on its own — only the abort ends it.
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          }),
      } as unknown as Response
    })
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
    })
    // Before the read moved inside the timer this hung forever (the timer had
    // already cleared); now the timeout aborts the stalled read.
    await expect(c.organizations.usageCsv("org_1")).rejects.toThrow()
  })
})
