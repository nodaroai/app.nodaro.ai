import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("executions resource", () => {
  it("listForWorkflow appends limit + status query params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.executions.listForWorkflow("wf-1", { limit: 5, status: "running" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/workflows/wf-1/executions")
    expect(url).toContain("limit=5")
    expect(url).toContain("status=running")
  })

  it("cancel throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Execution not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.executions.cancel("missing")).rejects.toBeInstanceOf(NotFoundError)
  })
})
