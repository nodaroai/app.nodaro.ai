import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { CommunityCard } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const card: CommunityCard = {
  id: "c1",
  entity_type: "character",
  creator_display_name: "Ada",
  slug: "ada-the-explorer",
  title: "Ada the Explorer",
  description: "A brave explorer",
  category: "people",
  style: "realistic",
  tags: ["explorer"],
  preview_media_url: null,
  preview_images: ["https://cdn/x.png"],
  clone_count: 3,
  favorite_count: 5,
  created_at: "2026-01-01T00:00:00Z",
}

describe("community resource", () => {
  it("browse() GETs /v1/community/browse with no query when no params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [card], nextCursor: null }))
    const out = await client(fetchMock).community.browse()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/community/browse")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual({ data: [card], nextCursor: null })
  })

  it("browse() serializes every filter into the query string", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], nextCursor: "next" }))
    const out = await client(fetchMock).community.browse({
      entityType: "object",
      q: "sword",
      category: "weapon",
      sort: "popular",
      cursor: "abc",
      limit: 10,
    })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/v1/community/browse")
    expect(url.searchParams.get("entityType")).toBe("object")
    expect(url.searchParams.get("q")).toBe("sword")
    expect(url.searchParams.get("category")).toBe("weapon")
    expect(url.searchParams.get("sort")).toBe("popular")
    expect(url.searchParams.get("cursor")).toBe("abc")
    expect(url.searchParams.get("limit")).toBe("10")
    expect(out.nextCursor).toBe("next")
  })

  it("get() GETs /v1/community/detail/:slug (encoded) and returns { data }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: card }))
    const out = await client(fetchMock).community.get("ada/the explorer")

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/community/detail/ada%2Fthe%20explorer",
    )
    expect(out).toEqual({ data: card })
  })

  it("favorites() GETs /v1/community/favorites", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [card] }))
    const out = await client(fetchMock).community.favorites()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/community/favorites")
    expect(out.data[0]!.slug).toBe("ada-the-explorer")
  })

  it("clone() POSTs /v1/community/listings/:id/clone with the entityType body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ entityType: "character", id: "new1" }))
    const out = await client(fetchMock).community.clone("c1", "character")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/community/listings/c1/clone")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ entityType: "character" })
    expect(out).toEqual({ entityType: "character", id: "new1" })
  })

  it("favorite() POSTs /v1/community/listings/:id/favorite and returns { favorited }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ favorited: true }))
    const out = await client(fetchMock).community.favorite("c1")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/community/listings/c1/favorite")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
    expect(out).toEqual({ favorited: true })
  })

  it("report() POSTs /v1/community/listings/:id/report with the reason body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ ok: true }))
    const out = await client(fetchMock).community.report("c1", "inappropriate")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/community/listings/c1/report")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ reason: "inappropriate" })
    expect(out).toEqual({ ok: true })
  })
})
