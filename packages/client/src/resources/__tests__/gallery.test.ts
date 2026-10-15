import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, GalleryResource } from "../../index.js"
import type { GalleryItem, GalleryPage, ToggleFavoriteResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const ITEM: GalleryItem = {
  id: "j1",
  type: "image",
  jobName: "generate-image",
  outputUrl: "https://cdn.example/j1.png",
  thumbnailUrl: null,
  createdAt: "2026-10-15T00:00:00Z",
  prompt: "a red fox",
  model: "nano-banana",
}

describe("gallery resource", () => {
  it("is on the client", () => {
    expect(client(vi.fn()).gallery).toBeInstanceOf(GalleryResource)
  })

  it("toggleFavorite POSTs { jobId } and resolves { favorited }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ favorited: true }))
    const result: ToggleFavoriteResult = await client(fetchMock).gallery.toggleFavorite("j1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/gallery/favorite")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ jobId: "j1" })
    expect(result).toEqual({ favorited: true })
  })

  it("toggleFavorite throws NotFoundError for a job you may not see", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Gallery item not found" } }))
    await expect(client(fetchMock).gallery.toggleFavorite("j1")).rejects.toBeInstanceOf(NotFoundError)
  })

  it("favorites GETs /v1/gallery/favorites and resolves the job ids, newest first", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: ["j2", "j1"] }))
    const ids: string[] = await client(fetchMock).gallery.favorites()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/gallery/favorites")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
    expect(ids).toEqual(["j2", "j1"])
  })

  it("browse GETs /v1/gallery with its filters and resolves the page", async () => {
    const page: GalleryPage = { data: [ITEM], nextCursor: "2026-10-14T00:00:00Z", totalCount: 1 }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(page))
    const result = await client(fetchMock).gallery.browse({
      type: "image",
      userId: "u1",
      favoritesOnly: true,
      limit: 20,
      cursor: "2026-10-15T00:00:00Z",
    })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/v1/gallery")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: "image",
      userId: "u1",
      favoritesOnly: "true",
      limit: "20",
      cursor: "2026-10-15T00:00:00Z",
    })
    expect(result).toEqual(page)
  })

  it("browse with no params is the public gallery, no query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    await client(fetchMock).gallery.browse()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/gallery")
  })
})
