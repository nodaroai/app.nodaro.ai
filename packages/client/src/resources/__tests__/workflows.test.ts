import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  CallbackAuth,
  NotFoundError,
  NodaroError,
} from "../../index.js"

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

  it("export GETs /v1/workflows/:id/export with assets=false by default", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { version: 1 } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.workflows.export("wf-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/workflows/wf-1/export?assets=false")
    expect(init.method).toBe("GET")
  })

  it("export passes assets=true through the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { version: 1 } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.workflows.export("wf-1", { assets: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/workflows/wf-1/export?assets=true",
    )
  })

  it("import POSTs to /v1/workflows/import with projectId + workflow_json", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "wf-2" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const bundle = {
      version: 1 as const,
      exportedAt: "2026-01-01T00:00:00Z",
      name: "Imported Flow",
      nodes: [],
      edges: [],
    }
    await c.workflows.import({ projectId: "proj-1", ...bundle })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/workflows/import")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({ projectId: "proj-1", workflow_json: bundle })
    expect(body.workflow_json.projectId).toBeUndefined()
  })

  it("getPublic GETs /v1/public/workflows/:id and returns the parsed `{ data }` body", async () => {
    const shared = {
      id: "wf-1",
      name: "Shared Flow",
      nodes: [{ id: "n1", type: "generate-image" }],
      settings: { studio: { shared: true } },
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: shared }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.workflows.getPublic("wf-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/public/workflows/wf-1")
    expect(init.method).toBe("GET")
    expect(result.data).toEqual(shared)
  })

  it("getPublic encodeURIComponent-escapes an id with a special char", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "a/b" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.workflows.getPublic("a/b")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/public/workflows/a%2Fb")
  })

  it("getPublic issues the share read with NO Authorization header when the auth has no token", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "wf-1" } }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      // A logged-out share viewer: the auth resolves to no token.
      auth: new CallbackAuth(() => null),
      fetch: fetchMock,
    })
    await c.workflows.getPublic("wf-1")
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it("getPublic throws NotFoundError (and NodaroError) on 404 — unshared or missing", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Workflow not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const err = await c.workflows.getPublic("not-shared").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err).toBeInstanceOf(NodaroError)
  })
})
