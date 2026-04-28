import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("workflows resource", () => {
  it("list builds URL with projectId path param", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.workflows.list({ projectId: "proj-1" })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/projects/proj-1/workflows",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("create POSTs to /v1/projects/:projectId/workflows without projectId in body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "wf-1" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.workflows.create({ projectId: "proj-1", name: "My Flow" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/projects/proj-1/workflows")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({ name: "My Flow" })
    expect(body.projectId).toBeUndefined()
  })

  it("get throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Workflow not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.workflows.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })
})
