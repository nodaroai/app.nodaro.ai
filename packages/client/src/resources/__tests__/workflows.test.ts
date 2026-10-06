import { describe, it, expect, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  CallbackAuth,
  NotFoundError,
  NodaroError,
  WorkflowConflictError,
  InsufficientCreditsError,
  type RunWorkflowParams,
  type RenderFinalParams,
  type RenderFinalQuote,
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

  it("update passes OCC fields and throws WorkflowConflictError on 409 with the current record", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        error: {
          code: "workflow_conflict",
          message: "Workflow was updated by another writer",
          currentUpdatedAt: "2026-07-27T10:00:00Z",
          currentVersion: 9,
          currentRecord: { id: "wf-1", name: "Fresh", updatedAt: "2026-07-27T10:00:00Z", version: 9 },
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })

    const err = await c.workflows
      .update("wf-1", { settings: { studio: {} }, expectedUpdatedAt: "2026-07-27T09:00:00Z" })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(WorkflowConflictError)
    const conflict = err as WorkflowConflictError
    expect(conflict.code).toBe("workflow_conflict")
    expect(conflict.currentUpdatedAt).toBe("2026-07-27T10:00:00Z")
    expect(conflict.currentVersion).toBe(9)
    expect(conflict.currentRecord).toMatchObject({ id: "wf-1", name: "Fresh" })

    // The OCC token rode the PATCH body.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      expectedUpdatedAt: "2026-07-27T09:00:00Z",
    })
  })

  it("run sends typed per-node inputOverrides — Render final is { [renderId]: { quality: \"final\" } }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "ex-1", status: "pending" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.workflows.run("wf-1", { nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/wf-1/run")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      nodeIds: ["cut", "cap"],
      inputOverrides: { cut: { quality: "final" } },
    })
  })

  it("run continues from an earlier execution: the nodes not named hand on that execution's output", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "ex-2", status: "pending" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const params = {
      nodeIds: ["cut", "cap"],
      inputOverrides: { cut: { quality: "final" } },
      continueFromExecutionId: "ex-1",
    } satisfies RunWorkflowParams
    await c.workflows.run("wf-1", params)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(params)
  })

  it("a refused continuation: not found is a NotFoundError, the rest carry their stable code", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(
        mockErr(404, { error: { code: "continuation_not_found", message: "The execution to continue from was not found." } }),
      )
      .mockReturnValueOnce(
        mockErr(400, { error: { code: "continuation_version_mismatch", message: "another version" } }),
      )
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const missing = await c.workflows.run("wf-1", { nodeIds: ["cut"], continueFromExecutionId: "ex-x" }).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(NotFoundError)
    const mismatch = await c.workflows.run("wf-1", { nodeIds: ["cut"], continueFromExecutionId: "ex-app" }).catch((e: unknown) => e)
    expect(mismatch).toBeInstanceOf(NodaroError)
    expect((mismatch as NodaroError).code).toBe("continuation_version_mismatch")
  })

  it("renderFinal asks the server for the Render final: it derives the nodes and the Final override", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "ex-3", status: "pending" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const params = { renderNodeId: "cut", continueFromExecutionId: "ex-1" } satisfies RenderFinalParams
    const result = await c.workflows.renderFinal("wf-1", params)
    expect(result.executionId).toBe("ex-3")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/wf-1/run")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      renderFinal: { renderNodeId: "cut" },
      continueFromExecutionId: "ex-1",
    })
  })

  it("estimateRenderFinal quotes it: the nodes it runs and its credits, nothing created", async () => {
    const quote = {
      renderNodeId: "cut",
      nodeIds: ["cut", "cap"],
      inputOverrides: { cut: { quality: "final" } },
      estimatedCredits: 530,
      sufficient: false,
      available: 50,
    } satisfies RenderFinalQuote
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: quote }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const { data } = await c.workflows.estimateRenderFinal("wf-1", { renderNodeId: "cut", continueFromExecutionId: "ex-1" })
    expect(data).toEqual(quote)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/wf-1/render-final/estimate")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ renderNodeId: "cut", continueFromExecutionId: "ex-1" })
  })

  it("a refused Render final carries its stable code; a 402 is InsufficientCreditsError", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockErr(400, { error: { code: "render_final_not_a_render", message: "not a render" } }))
      .mockReturnValueOnce(
        mockErr(402, {
          error: { code: "insufficient_credits", message: "Insufficient credits. Required: 530, Available: 50", required: 530, available: 50 },
        }),
      )
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const params = { renderNodeId: "cap", continueFromExecutionId: "ex-1" }
    const refused = await c.workflows.renderFinal("wf-1", params).catch((e: unknown) => e)
    expect((refused as NodaroError).code).toBe("render_final_not_a_render")
    const poor = await c.workflows.renderFinal("wf-1", params).catch((e: unknown) => e)
    expect(poor).toBeInstanceOf(InsufficientCreditsError)
    expect((poor as InsufficientCreditsError).required).toBe(530)
    expect((poor as InsufficientCreditsError).available).toBe(50)
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

  // ── P11: visibility / move / shared-with-me / collaborators ────────────────

  it("setVisibility PATCHes the workflow with the visibility lever", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { id: "wf-1", visibility: "workspace" } }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.workflows.setVisibility("wf-1", "workspace")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/workflows/wf-1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body)).toEqual({ visibility: "workspace" })
  })

  it("move POSTs to /move and surfaces droppedCollaborators", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ data: { id: "wf-1" }, droppedCollaborators: [{ userId: "u9", name: "Dana" }] }),
    )
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const res = await c.workflows.move("wf-1", { projectId: "proj-2" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/workflows/wf-1/move")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ projectId: "proj-2" })
    expect(res.droppedCollaborators[0]).toEqual({ userId: "u9", name: "Dana" })
  })

  it("sharedWithMe GETs the shared list", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [{ id: "wf-1", grantedRole: "viewer" }] }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const res = await c.workflows.sharedWithMe()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/shared-with-me")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
    expect(res.data[0].grantedRole).toBe("viewer")
  })

  it("collaborators.list GETs the workflow's collaborators", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.workflows.collaborators.list("wf-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/wf-1/collaborators")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("collaborators.add POSTs the userId-or-email body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { userId: "u2", role: "editor" } }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.workflows.collaborators.add("wf-1", { email: "dana@example.com", role: "editor" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/workflows/wf-1/collaborators")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ email: "dana@example.com", role: "editor" })
  })

  it("collaborators.update PATCHes the per-user role, remove DELETEs it", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: { userId: "u2", role: "viewer" } }))
      .mockReturnValueOnce(mockOk({ success: true }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.workflows.collaborators.update("wf-1", "u2", { role: "viewer" })
    await c.workflows.collaborators.remove("wf-1", "u2")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/workflows/wf-1/collaborators/u2")
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/workflows/wf-1/collaborators/u2")
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE")
  })
})
