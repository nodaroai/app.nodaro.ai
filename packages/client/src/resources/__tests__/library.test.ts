import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { ListLibraryResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const PAGE: ListLibraryResult = {
  data: [
    {
      id: "a1",
      type: "image",
      filename: "shot.png",
      mimeType: "image/png",
      sizeBytes: 100,
      url: "https://cdn.example.com/a1.png",
      thumbnailUrl: "https://cdn.example.com/a1_thumb.png",
      metadata: {},
      isLibraryItem: false,
      uploadSource: "generated",
      createdAt: "2026-06-08T00:00:00Z",
    },
  ],
  nextCursor: "a1",
  totalCount: 1,
}

describe("library resource", () => {
  it("list() GETs /v1/library with type/search/owned/limit/cursor and returns the page", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(PAGE))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const res = await c.library.list({
      type: "image",
      search: "shot",
      owned: true,
      limit: 24,
      cursor: "c0",
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/library?")
    expect(url).toContain("type=image")
    expect(url).toContain("search=shot")
    expect(url).toContain("owned=true")
    expect(url).toContain("limit=24")
    expect(url).toContain("cursor=c0")
    const init = fetchMock.mock.calls[0][1] as { method: string }
    expect(init.method).toBe("GET")

    expect(res).toEqual(PAGE)
    expect(res.data[0].url).toBe("https://cdn.example.com/a1.png")
    expect(res.nextCursor).toBe("a1")
  })

  it("list() with no params hits the bare /v1/library (no query string)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    const c = createClient({
      baseUrl: "https://api.example.com",
      auth: new StaticTokenAuth("t"),
      fetch: fetchMock,
    })
    const res = await c.library.list()

    const url = fetchMock.mock.calls[0][0] as string
    expect(url.endsWith("/v1/library")).toBe(true)
    expect(res.data).toEqual([])
    expect(res.nextCursor).toBeNull()
  })
})
