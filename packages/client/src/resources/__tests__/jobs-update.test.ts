import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)

describe("jobs.update()", () => {
  it("PATCHes /v1/jobs/:id with a cover by asset id, and returns the picture now", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1", coverUrl: "https://cdn/c.png" } }))
    const out = await make(fetchMock).jobs.update("job-1", { cover: { assetId: "asset-1" } })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/job-1")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("PATCH")
    expect(bodyOf(fetchMock)).toEqual({ cover: { assetId: "asset-1" } })
    expect(out.data.coverUrl).toBe("https://cdn/c.png")
  })

  it("sends a name and a cover by address together, and only the fields given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1", title: "T", coverUrl: "u" } }))
    await make(fetchMock).jobs.update("job-1", { title: "T", cover: { url: "https://cdn/x.png" } })
    expect(bodyOf(fetchMock)).toEqual({ title: "T", cover: { url: "https://cdn/x.png" } })
  })

  it("clears the cover with an explicit null", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1", coverUrl: null } }))
    await make(fetchMock).jobs.update("job-1", { cover: null })
    expect(bodyOf(fetchMock)).toEqual({ cover: null })
  })
})
