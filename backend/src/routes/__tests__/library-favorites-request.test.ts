/**
 * `GET /v1/library?favorited=` as the database sees it: the requests a REAL
 * query builder sends (test/capturing-supabase.ts), not which methods were
 * called.
 *
 * The defect this pins: the filter used to read every favorite id of the
 * caller and send them back in the request line (`id=in.(…)`), so past a few
 * hundred favorites the URL outgrew the gateway's limit and the read failed.
 * Now the predicate is the database's (migration 688,
 * `library_assets_by_favorite`): the request names the caller, so its size
 * does not depend on how many favorites they have — asserted here with none
 * and with thousands — and no favorites table is read at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { CannedAnswer, CapturedRequest } from "../../test/capturing-supabase.js"

const cap = vi.hoisted(() => ({
  /** Favorite ids the database holds: a read of a favorites table would answer them all. */
  favoriteIds: [] as string[],
  /** The answer to the listing function (e.g. a missing-function error). */
  functionAnswer: null as CannedAnswer | null,
  /** The rows a listing page answers. */
  pageRows: [] as Array<Record<string, unknown>>,
  /** The ids `library_favorite_asset_ids` answers as favorites. */
  starred: [] as string[],
  requests: [] as CapturedRequest[],
}))

vi.mock("../../lib/supabase.js", async () => {
  const { capturingSupabase } = await import("../../test/capturing-supabase.js")
  const { client, requests } = capturingSupabase((req) => {
    const path = req.url.pathname
    if (/\/(gallery_favorites|asset_favorites)$/.test(path)) return { body: cap.favoriteIds.map((id) => ({ id, job_id: id, asset_id: id })) }
    if (path.endsWith("/rpc/library_favorite_asset_ids")) return { body: cap.starred }
    if (path.endsWith("/rpc/library_assets_by_favorite") && cap.functionAnswer) return cap.functionAnswer
    if (req.method === "HEAD") return { count: 3 }
    // The cursor row's own timestamp (`.single()`: one object).
    if (path.endsWith("/assets") && req.url.searchParams.get("select") === "created_at") return { body: { created_at: "2026-08-01T00:00:00+00:00" } }
    if (path.endsWith("/rpc/library_assets_by_favorite") || path.endsWith("/assets")) return { body: cap.pageRows }
    return { body: [] }
  })
  cap.requests = requests
  return { supabase: client }
})
vi.mock("../../lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("../../lib/render-label-fill.js", () => ({ fillAssetRenderQuality: async (rows: readonly unknown[]) => [...rows] }))

const { libraryRoutes } = await import("../library.js")
const { setFavoritesTablesPresentForTests } = await import("../../lib/favorites-tables.js")

const USER = "11111111-1111-4111-8111-111111111111"
const CURSOR = "22222222-2222-4222-8222-222222222222"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** Comfortably under any gateway's request-line limit (they start at 8 KB). */
const URL_BUDGET = 2048

let app: FastifyInstance
beforeEach(async () => {
  cap.requests.length = 0
  cap.favoriteIds = []
  cap.functionAnswer = null
  cap.pageRows = []
  cap.starred = []
  setFavoritesTablesPresentForTests(true)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

const list = (qs: string) => app.inject({ method: "GET", url: `/v1/library?${qs}` })
/** The listing's page and count (not the cursor row's own lookup). */
const listingRequests = () =>
  cap.requests.filter((r) => /\/rpc\/library_assets_by_favorite$|\/assets$/.test(r.url.pathname) && r.url.searchParams.get("select") !== "created_at")
/** A request's filters: every query parameter but the projection. */
const filtersOf = (r: CapturedRequest) => [...r.url.searchParams.entries()].filter(([k]) => k !== "select").sort()

describe("GET /v1/library?favorited= — the request stays bounded whatever the favorite count", () => {
  for (const favorited of ["true", "false"] as const) {
    it(`favorited=${favorited}: the page and the count go through the database function, naming only the caller`, async () => {
      const res = await list(`favorited=${favorited}&type=image&source=sdk&q=beach`)
      expect(res.statusCode).toBe(200)
      const reqs = listingRequests()
      expect(reqs.map((r) => `${r.method} ${r.url.pathname}`).sort()).toEqual([
        "HEAD /rest/v1/rpc/library_assets_by_favorite",
        "POST /rest/v1/rpc/library_assets_by_favorite",
      ])
      const page = reqs.find((r) => r.method === "POST")!
      const count = reqs.find((r) => r.method === "HEAD")!
      expect(page.body).toEqual({ p_user_id: USER, p_favorited: favorited === "true" })
      expect(count.url.searchParams.get("p_user_id")).toBe(USER)
      expect(count.url.searchParams.get("p_favorited")).toBe(favorited)
      // No favorites table is read: nothing about the favorites travels in a request.
      expect(cap.requests.some((r) => /favorites/.test(r.url.pathname) && !r.url.pathname.includes("/rpc/"))).toBe(false)
      expect(res.json().totalCount).toBe(3)
    })
  }

  it("is the same request with no favorites and with 5,000 of them — and under the URL budget", async () => {
    await list(`favorited=true&cursor=${CURSOR}`)
    const none = cap.requests.map((r) => `${r.method} ${r.href}`)
    cap.requests.length = 0
    cap.favoriteIds = Array.from({ length: 5000 }, (_, n) => id(n + 1))
    await list(`favorited=true&cursor=${CURSOR}`)
    const many = cap.requests.map((r) => `${r.method} ${r.href}`)
    expect(many).toEqual(none)
    for (const r of cap.requests) expect(r.href.length).toBeLessThan(URL_BUDGET)
  })

  it("applies the listing's every other filter exactly as the unfiltered listing does (one filter set, two sources)", async () => {
    const qs = `type=video&source=sdk&q=sun%20set&cursor=${CURSOR}`
    await list(qs)
    const plain = listingRequests().filter((r) => r.method === "GET").map(filtersOf)
    cap.requests.length = 0
    await list(`${qs}&favorited=true`)
    const fav = listingRequests().filter((r) => r.method === "POST").map(filtersOf)
    expect(plain).toHaveLength(1)
    expect(fav).toEqual(plain)
    // The cursor's keyset is among them.
    expect(plain[0]!.some(([k, v]) => k === "or" && v.includes(`id.lt.${CURSOR}`))).toBe(true)
    // …and so does the count (first page).
    cap.requests.length = 0
    await list("owned=true&type=audio")
    const plainCount = listingRequests().filter((r) => r.method === "HEAD").map(filtersOf)
    cap.requests.length = 0
    await list("owned=true&type=audio&favorited=false")
    const favCount = listingRequests()
      .filter((r) => r.method === "HEAD")
      .map((r) => filtersOf(r).filter(([k]) => k !== "p_user_id" && k !== "p_favorited"))
    expect(favCount).toEqual(plainCount)
    // The files-only and restricted rules are among them.
    const favParams = new URLSearchParams(favCount[0]!.map(([k, v]) => [k, v] as [string, string]))
    expect(favParams.getAll("r2_url").sort()).toEqual(["neq.", "not.is.null"])
    expect(favParams.getAll("restricted_at")).toEqual(["is.null"])
  })

  it("the function's page selects every column, so any filter it carries names a selected column", async () => {
    await list("favorited=true")
    const page = listingRequests().find((r) => r.method === "POST")!
    expect(page.url.searchParams.get("select")).toMatch(/^\*/)
  })

  it("each listed file's flag is the filter's value: no second read", async () => {
    const { supabase } = await import("../../lib/supabase.js")
    const spy = vi.spyOn(supabase, "rpc")
    await list("favorited=true")
    expect(spy.mock.calls.map((c) => c[0])).not.toContain("library_favorite_asset_ids")
    spy.mockRestore()
  })
})

describe("GET /v1/library?favorited= before migration 688 reaches the database", () => {
  it("answers 503 not_available without a request (never a 500, never a list that is not the one asked for)", async () => {
    setFavoritesTablesPresentForTests(false)
    const res = await list("favorited=true")
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
    expect(listingRequests()).toEqual([])
  })

  it("a function the schema cache does not have yet is the same 503", async () => {
    cap.functionAnswer = { status: 404, body: { code: "PGRST202", message: "Could not find the function public.library_assets_by_favorite" } }
    const res = await list("favorited=false")
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("any other failure of the function is a sanitized 500", async () => {
    cap.functionAnswer = { status: 500, body: { code: "57014", message: "canceling statement due to statement timeout" } }
    const res = await list("favorited=true")
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to load library" } })
  })
})

describe("GET /v1/library's per-page flag", () => {
  it("is one call for a full page, its ids in the body — a bounded request line — answered per file", async () => {
    cap.pageRows = Array.from({ length: 100 }, (_, n) => ({ id: id(n + 1), job_id: null, type: "image", r2_url: "https://cdn.test/f", metadata: {}, created_at: "2026-01-01T00:00:00Z" }))
    cap.starred = [id(1), id(7)]
    const res = await list("limit=100")
    expect(res.statusCode).toBe(200)
    const flagReads = cap.requests.filter((r) => r.url.pathname.endsWith("/rpc/library_favorite_asset_ids"))
    expect(flagReads).toHaveLength(1)
    expect(flagReads[0]!.method).toBe("POST")
    expect(flagReads[0]!.body).toEqual({ p_user_id: USER, p_asset_ids: cap.pageRows.map((r) => r.id) })
    expect(flagReads[0]!.href.length).toBeLessThan(URL_BUDGET)
    const flags = res.json().data.map((a: { id: string; favorited: boolean }) => a.favorited)
    expect(flags.filter(Boolean)).toHaveLength(2)
    expect(res.json().data[0].favorited).toBe(true)
    expect(res.json().data[1].favorited).toBe(false)
  })
})
