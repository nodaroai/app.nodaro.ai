import { describe, expect, it, vi } from "vitest"
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

const FACETS = {
  total: 681,
  use_cases: [{ value: "characters_animation", count: 681 }, { value: "social_media", count: 930 }],
  languages: [{ value: "en", count: 681 }, { value: "es", count: 496 }],
  descriptives: [{ value: "confident", count: 73 }],
  genders: [],
  ages: [],
  accents: [],
  categories: [],
  approximate: false,
  updatedAt: "2026-11-09T06:00:00.000Z",
}

describe("voices.libraryFacets()", () => {
  it("GETs /v1/voices/library/facets with the filters as a querystring and returns the counts as sent", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(FACETS))
    const c = make(fetchMock)
    const out = await c.voices.libraryFacets({ use_cases: "characters_animation", language: "en", featured: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(url).toMatch(/^https:\/\/api\.example\.com\/v1\/voices\/library\/facets\?/)
    expect(url).toContain("use_cases=characters_animation")
    expect(url).toContain("language=en")
    expect(url).toContain("featured=true")
    expect(out).toEqual(FACETS)
  })

  it("omits undefined, null and empty filters so the server counts the whole library", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(FACETS))
    const c = make(fetchMock)
    await c.voices.libraryFacets({ search: "", gender: undefined, descriptives: "calm" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("descriptives=calm")
    expect(url).not.toContain("search=")
    expect(url).not.toContain("gender=")
    expect(url).not.toContain("undefined")
  })

  it("with no params, asks for the whole library", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(FACETS))
    const c = make(fetchMock)
    await c.voices.libraryFacets()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voices/library/facets")
  })
})
