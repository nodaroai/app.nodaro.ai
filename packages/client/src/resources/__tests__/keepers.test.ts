import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, KEEPER_KINDS } from "../../index.js"
import type { KeeperCatalogPage, CopyKeeperResult, SetKeeperCatalogResult } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

describe("keepers resource", () => {
  it("catalog GETs /v1/keepers/catalog, passing kind / cursor / limit through the query string", async () => {
    const page: KeeperCatalogPage = { data: [], next: null }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(page))
    const c = client(fetchMock)
    await c.keepers.catalog()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/keepers/catalog")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")

    fetchMock.mockReturnValueOnce(mockOk(page))
    const result = await c.keepers.catalog({ kind: "creature", cursor: "abc", limit: 20 })
    const url = fetchMock.mock.calls[1][0] as string
    expect(url).toContain("kind=creature")
    expect(url).toContain("cursor=abc")
    expect(url).toContain("limit=20")
    expect(result).toEqual(page)
    expect(KEEPER_KINDS).toEqual(["character", "creature", "location", "object"])
  })

  it("copy POSTs /v1/keepers/catalog/:kind/:id/copy and answers the caller's copy", async () => {
    const copy: CopyKeeperResult = { id: "copy-1", name: "Mira", kind: "character", created: true }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(copy))
    const result = await client(fetchMock).keepers.copy("character", "item 1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/keepers/catalog/character/item%201/copy")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(result).toEqual(copy)
  })

  it("setCatalog on each kind resource PUTs /v1/<kinds>/:id/catalog with the body", async () => {
    const answer: SetKeeperCatalogResult = { id: "item-1", kind: "object", catalog: true, sort: 1, category: null }
    const fetchMock = vi.fn().mockReturnValue(mockOk(answer))
    const c = client(fetchMock)
    await c.characters.setCatalog("item-1", { catalog: true, sort: 1 })
    await c.creatures.setCatalog("item-1", { catalog: false })
    await c.locations.setCatalog("item-1", { catalog: true, category: "Cities" })
    await c.objects.setCatalog("item-1", { catalog: true, category: null })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.com/v1/characters/item-1/catalog",
      "https://api.example.com/v1/creatures/item-1/catalog",
      "https://api.example.com/v1/locations/item-1/catalog",
      "https://api.example.com/v1/objects/item-1/catalog",
    ])
    for (const call of fetchMock.mock.calls) expect(call[1].method).toBe("PUT")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ catalog: true, sort: 1 })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ catalog: true, category: null })
  })
})
