import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import { KEEPER_KIND_PATH, readKeeperShelf, setKeeperCatalog } from "../api"

const ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the Keepers shelf client", () => {
  it("reads the item's own by-id route and keeps only the three shelf fields, camel to form", async () => {
    const fetch = mockFetchJson({ id: ID, name: "Mira", catalog: true, catalogSort: 3, catalogCategory: "Heroes", voice: null })
    vi.stubGlobal("fetch", fetch)

    await expect(readKeeperShelf("creature", ID)).resolves.toEqual({ catalog: true, sort: 3, category: "Heroes" })
    expect(fetch.mock.calls[0][0]).toBe(`/v1/creatures/${ID}`)
  })

  it("an older server that reports no shelf fields reads as off the shelf", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ id: ID, name: "Mira" }))
    await expect(readKeeperShelf("character", ID)).resolves.toEqual({ catalog: false, sort: 0, category: null })
  })

  it("writes through PUT on the kind's catalog route with the body as given", async () => {
    const fetch = mockFetchJson({ id: ID, kind: "object", catalog: true, sort: 1, category: null })
    vi.stubGlobal("fetch", fetch)

    const result = await setKeeperCatalog("object", ID, { catalog: true, sort: 1, category: null })
    expect(result).toEqual({ id: ID, kind: "object", catalog: true, sort: 1, category: null })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`/v1/objects/${ID}/catalog`)
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({ catalog: true, sort: 1, category: null })
  })

  it("every kind's prefix is the kind's own route family", () => {
    expect(KEEPER_KIND_PATH).toEqual({
      character: "/v1/characters",
      creature: "/v1/creatures",
      location: "/v1/locations",
      object: "/v1/objects",
    })
  })
})
