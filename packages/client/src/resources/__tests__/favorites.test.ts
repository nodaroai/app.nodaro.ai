import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { FavoriteItem, ListFavoritesResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const ITEMS: FavoriteItem[] = [
  { kind: "catalog", id: "style/watercolor", favoritedAt: "2026-11-23T10:00:02.5+00:00", catalog: { catalog: "style", optionId: "watercolor", label: "Watercolor" } },
  { kind: "voice", id: "v1", favoritedAt: "2026-11-23T10:00:01+00:00", voice: { voiceId: "v1", voiceType: "premade", name: "Rachel", previewUrl: null } },
]

describe("favorites resource", () => {
  it("list() GETs /v1/favorites with kinds, limit and cursor and returns the page", async () => {
    const page: ListFavoritesResult = { data: ITEMS, nextCursor: "next" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(page))
    const res = await client(fetchMock).favorites.list({ kinds: ["job", "asset", "catalog"], limit: 20, cursor: "c0" })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/v1/favorites")
    expect(url.searchParams.get("kinds")).toBe("job,asset,catalog")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(url.searchParams.get("cursor")).toBe("c0")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(res).toEqual(page)
  })

  it("list() with no params hits the bare route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: null }))
    await client(fetchMock).favorites.list()
    expect((fetchMock.mock.calls[0][0] as string).endsWith("/v1/favorites")).toBe(true)
  })

  it("listCatalog() reads one catalog's favorite options, or all of them", async () => {
    const fav = { catalog: "music-genre", optionId: "genre:jazz", label: "Jazz", createdAt: "2026-11-23T10:00:00+00:00" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [fav] })).mockReturnValueOnce(mockOk({ data: [] }))
    const c = client(fetchMock)
    expect(await c.favorites.listCatalog("music-genre")).toEqual([fav])
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/favorites/catalog?catalog=music-genre")
    expect(await c.favorites.listCatalog()).toEqual([])
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/favorites/catalog")
  })

  it("addCatalog() PUTs and removeCatalog() DELETEs the encoded catalog and option ids", async () => {
    const added = { catalog: "music-genre", optionId: "genre:jazz", label: "Jazz", favorited: true, createdAt: "2026-11-23T10:00:00+00:00" }
    const removed = { catalog: "music-genre", optionId: "genre:jazz", favorited: false }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: added })).mockReturnValueOnce(mockOk({ data: removed }))
    const c = client(fetchMock)
    expect(await c.favorites.addCatalog("music-genre", "genre:jazz")).toEqual(added)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/favorites/catalog/music-genre/genre%3Ajazz")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("PUT")
    expect(await c.favorites.removeCatalog("music-genre", "genre:jazz")).toEqual(removed)
    expect((fetchMock.mock.calls[1][1] as { method: string }).method).toBe("DELETE")
  })
})
