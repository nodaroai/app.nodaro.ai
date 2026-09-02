import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, ForbiddenError } from "../index.js"

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
