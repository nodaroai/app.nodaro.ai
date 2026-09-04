/**
 * The entity list fns drain EVERY page.
 *
 * The owner had 100+ characters and saw exactly 100 everywhere — My Library,
 * the copilot's @ picker, the galleries — because /v1/characters pages at 100
 * and nothing followed `nextCursor`. Every consumer of these fns filters
 * client-side over what it got, so one page is a silent lie to all of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/runtime-config", () => ({
  runtimeApiUrl: () => "",
  runtimeSupabaseUrl: () => "https://test.supabase.co",
  runtimeSupabaseAnonKey: () => "anon",
  // api.ts localizes the deployment-payer 402 at the throw point, which pulls
  // the (tiny) i18n module in behind it; the locale store resolves its initial
  // locale at import time and reads this. A whole-module mock has to answer it.
  runtimeDefaultLocale: () => null,
}))
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const { getCharacters, getObjects, getCreatures, getLocations, listArchivedCharacters } = await import("../api")

/** Serve scripted pages; capture every request URL. */
function servePages(key: string, pages: Array<{ rows: unknown[]; nextCursor: string | null }>) {
  const urls: string[] = []
  let call = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url))
      const page = pages[Math.min(call++, pages.length - 1)]
      return new Response(JSON.stringify({ [key]: page.rows, nextCursor: page.nextCursor }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }),
  )
  return urls
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe("drainEntityPages via the public fns", () => {
  it("follows nextCursor until the server says done, and concatenates", async () => {
    const urls = servePages("characters", [
      { rows: [{ id: "a" }, { id: "b" }], nextCursor: "CUR1" },
      { rows: [{ id: "c" }], nextCursor: "CUR2" },
      { rows: [{ id: "d" }], nextCursor: null },
    ])
    const { characters } = await getCharacters(undefined, "u1")
    expect(characters.map((c) => (c as { id: string }).id)).toEqual(["a", "b", "c", "d"])
    expect(urls).toHaveLength(3)
    expect(urls[0]).not.toContain("cursor=")
    expect(urls[1]).toContain("cursor=CUR1")
    expect(urls[2]).toContain("cursor=CUR2")
  })

  it("asks for the server's max page size, not the 100-row default", async () => {
    const urls = servePages("characters", [{ rows: [], nextCursor: null }])
    await getCharacters()
    expect(urls[0]).toContain("limit=500")
  })

  it("stops on a non-advancing cursor instead of looping forever, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    servePages("characters", [{ rows: [{ id: "x" }], nextCursor: "SAME" }])
    const { characters } = await getCharacters()
    // 20 pages, then the report — never an infinite loop, never silence.
    expect(characters).toHaveLength(20)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cursor still advancing"))
  })

  it("every entity kind drains — objects, creatures, locations, and the archive", async () => {
    for (const [key, fn] of [
      ["objects", () => getObjects(undefined, "u1")],
      ["creatures", () => getCreatures(undefined, "u1")],
      ["locations", () => getLocations(undefined, "u1")],
      ["characters", () => listArchivedCharacters()],
    ] as const) {
      const urls = servePages(key, [
        { rows: [{ id: "1" }], nextCursor: "N" },
        { rows: [{ id: "2" }], nextCursor: null },
      ])
      const result = (await fn()) as Record<string, unknown[]>
      expect(result[key], key).toHaveLength(2)
      expect(urls, key).toHaveLength(2)
      vi.unstubAllGlobals()
    }
  })

  it("keeps the filters on every page of the loop", async () => {
    const urls = servePages("characters", [
      { rows: [], nextCursor: "C" },
      { rows: [], nextCursor: null },
    ])
    await getCharacters("proj-1", "u1")
    for (const url of urls) {
      expect(url).toContain("projectId=proj-1")
      expect(url).toContain("userId=u1")
    }
  })
})
