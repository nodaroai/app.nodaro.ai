import { describe, it, expect, vi } from "vitest"
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

describe("voices resource", () => {
  it("list() GETs /v1/voices and returns voices[]", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ voices: [{ voice_id: "v1", name: "Rachel" }] }),
    )
    const c = make(fetchMock)
    const out = await c.voices.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voices")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual([{ voice_id: "v1", name: "Rachel" }])
  })

  it("searchLibrary() builds the querystring and returns { voices, hasMore }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ voices: [], hasMore: true }))
    const c = make(fetchMock)
    const out = await c.voices.searchLibrary({ search: "deep", gender: "male", page: 2, page_size: 30 })
    const url = fetchMock.mock.calls[0][0] as string
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(url).toMatch(/^https:\/\/api\.example\.com\/v1\/voices\/library\?/)
    expect(url).toContain("search=deep")
    expect(url).toContain("gender=male")
    expect(url).toContain("page=2")
    expect(out.hasMore).toBe(true)
  })

  it("searchLibrary() omits undefined params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ voices: [], hasMore: false }))
    const c = make(fetchMock)
    await c.voices.searchLibrary({ search: "x" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("gender=")
    expect(url).not.toContain("undefined")
  })
})
