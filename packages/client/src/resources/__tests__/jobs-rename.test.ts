import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

describe("jobs.rename()", () => {
  it("PATCHes /v1/jobs/:id with { title } and returns the job's name now", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1", title: "Hero shot v2" } }))
    const c = make(fetchMock)
    const out = await c.jobs.rename("job-1", "Hero shot v2")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/job-1")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body)).toEqual({ title: "Hero shot v2" })
    expect(out).toEqual({ data: { jobId: "job-1", title: "Hero shot v2" } })
  })

  it("clears the name with null — an explicit field, never a missing one", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1", title: null } }))
    const c = make(fetchMock)
    const out = await c.jobs.rename("job-1", null)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ title: null })
    expect(out.data.title).toBeNull()
  })

  it("encodes the job id in the path", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "a/b", title: "x" } }))
    await make(fetchMock).jobs.rename("a/b", "x")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/a%2Fb")
  })
})
