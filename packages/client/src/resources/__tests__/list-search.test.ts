/**
 * `q` — the search text of the saved-entity lists and the library.
 *
 * The server does the matching (name or description for the four kinds,
 * filename for the library; ignoring case, every character literal); the SDK's
 * job is to put the text on the wire unchanged, beside every other filter,
 * and to keep the library's original `search` working.
 */
import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function client() {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [], nextCursor: null }) } as unknown as Response),
  )
  const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
  const sent = () => new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]![0] as string)
  return { c, sent }
}

const LISTS = [
  { name: "characters", path: "/v1/characters", list: (c: ReturnType<typeof client>["c"], p: object) => c.characters.list(p) },
  { name: "locations", path: "/v1/locations", list: (c: ReturnType<typeof client>["c"], p: object) => c.locations.list(p) },
  { name: "objects", path: "/v1/objects", list: (c: ReturnType<typeof client>["c"], p: object) => c.objects.list(p) },
  { name: "creatures", path: "/v1/creatures", list: (c: ReturnType<typeof client>["c"], p: object) => c.creatures.list(p) },
] as const

describe.each(LISTS)("$name.list({ q })", ({ path, list }) => {
  it("sends the search text as q, unchanged", async () => {
    const { c, sent } = client()
    await list(c, { q: "Maya, 50%_* (v2)" })

    expect(sent().pathname).toBe(path)
    expect(sent().searchParams.get("q")).toBe("Maya, 50%_* (v2)")
  })

  it("sends q beside the other filters and the cursor", async () => {
    const { c, sent } = client()
    await list(c, { q: "hero", archived: true, limit: 10, cursor: "c1" })

    const params = sent().searchParams
    expect(params.get("q")).toBe("hero")
    expect(params.get("archived")).toBe("true")
    expect(params.get("limit")).toBe("10")
    expect(params.get("cursor")).toBe("c1")
  })

  it("sends no q when there is no search text", async () => {
    const { c, sent } = client()
    await list(c, {})
    expect(sent().searchParams.has("q")).toBe(false)

    await list(c, { q: "" })
    expect(sent().searchParams.has("q")).toBe(false)
  })
})

describe("library.list({ q, search })", () => {
  it("sends q", async () => {
    const { c, sent } = client()
    await c.library.list({ q: "poster 50%" })

    expect(sent().searchParams.get("q")).toBe("poster 50%")
    expect(sent().searchParams.has("search")).toBe(false)
  })

  it("still sends the deprecated search on its own, so older servers keep filtering", async () => {
    const { c, sent } = client()
    await c.library.list({ search: "report" })

    expect(sent().searchParams.get("search")).toBe("report")
    expect(sent().searchParams.has("q")).toBe(false)
  })

  it("sends only q when both are given — q wins", async () => {
    const { c, sent } = client()
    await c.library.list({ q: "poster", search: "report" })

    expect(sent().searchParams.get("q")).toBe("poster")
    expect(sent().searchParams.has("search")).toBe(false)
  })
})
