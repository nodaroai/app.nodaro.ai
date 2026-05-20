import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, ForbiddenError } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("pipelines resource", () => {
  it("branch POSTs to /v1/pipelines/:id/branch with fromStage in body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ pipelineId: "new-pipe-1", clonedStages: ["script"], clonedEntities: 3 }, 201),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const result = await c.pipelines.branch("orig-pipe-1", { fromStage: "characters" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/pipelines/orig-pipe-1/branch")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body).toEqual({ fromStage: "characters" })
    expect(result.pipelineId).toBe("new-pipe-1")
    expect(result.clonedStages).toEqual(["script"])
    expect(result.clonedEntities).toBe(3)
  })

  it("branch encodes the pipeline id in the URL", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ pipelineId: "p2", clonedStages: [], clonedEntities: 0 }, 201),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.pipelines.branch("pipe/with/slashes", { fromStage: "script" })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/pipelines/pipe%2Fwith%2Fslashes/branch",
    )
  })

  it("branch throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Pipeline not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.pipelines.branch("missing", { fromStage: "script" })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("branch throws ForbiddenError on 403", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(403, { error: { code: "forbidden" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(
      c.pipelines.branch("other-user-pipe", { fromStage: "locations" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
