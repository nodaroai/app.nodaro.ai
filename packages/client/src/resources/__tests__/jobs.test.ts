import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

describe("jobs resource", () => {
  it("cancel POSTs to /v1/jobs/:id/cancel", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true, cancelled: 1 }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.jobs.cancel("job-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/job-1/cancel")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
  })

  it("get throws NotFoundError on 404", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Job not found" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await expect(c.jobs.get("missing")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("getStatus GETs the lean /v1/jobs/:id/status endpoint", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        data: {
          id: "job-1",
          status: "completed",
          progress: 100,
          output_data: {},
          error_message: null,
        },
      }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.jobs.getStatus("job-1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/jobs/job-1/status",
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("getStatus url-encodes the job id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ data: { id: "job/1", status: "completed" } }),
    )
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    await c.jobs.getStatus("job/1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/jobs/job%2F1/status",
    )
  })
})
