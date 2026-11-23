import { describe, it, expect, vi, expectTypeOf } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { LibraryAsset, ListLibraryResult } from "../../index.js"

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
      source: null,
      sourceDetail: null,
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

describe("LibraryAsset.jobId", () => {
  it("is the optional id of the job that made the file", async () => {
    expectTypeOf<LibraryAsset["jobId"]>().toEqualTypeOf<string | null | undefined>()
    const row: LibraryAsset = { ...PAGE.data[0], jobId: "11111111-1111-4111-8111-111111111111" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [row, { ...row, id: "a2", jobId: null }], nextCursor: null }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const res = await c.library.list({ owned: true })
    expect(res.data[0].jobId).toBe("11111111-1111-4111-8111-111111111111")
    expect(res.data[1].jobId).toBeNull()
  })
})

describe("library favorites", () => {
  it("list({ favorited }) sends the filter beside the others, and each row may carry favorited", async () => {
    expectTypeOf<LibraryAsset["favorited"]>().toEqualTypeOf<boolean | undefined>()
    const row: LibraryAsset = { ...PAGE.data[0], favorited: true }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [row], nextCursor: null }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const res = await c.library.list({ favorited: true, type: "image", source: "sdk", cursor: "c1" })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/v1/library")
    expect(url.searchParams.get("favorited")).toBe("true")
    expect(url.searchParams.get("type")).toBe("image")
    expect(url.searchParams.get("source")).toBe("sdk")
    expect(url.searchParams.get("cursor")).toBe("c1")
    expect(res.data[0].favorited).toBe(true)
  })

  it("list({ favorited: false }) sends false (not omitted)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.library.list({ favorited: false })
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("favorited")).toBe("false")
  })

  it("favorite() POSTs /v1/library/:id/favorite with the wanted state, or an empty body to toggle", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ favorited: true, jobId: null }))
      .mockReturnValueOnce(mockOk({ favorited: false, jobId: "j1" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const starred = await c.library.favorite("a1", true)
    expect(starred).toEqual({ favorited: true, jobId: null })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/library/a1/favorite")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ favorited: true })

    const toggled = await c.library.favorite("a1")
    expect(toggled.favorited).toBe(false)
    expect(JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)).toEqual({})
  })
})
