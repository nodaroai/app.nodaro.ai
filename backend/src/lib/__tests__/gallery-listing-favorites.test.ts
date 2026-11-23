/**
 * `GET /v1/gallery?favoritesOnly=true` as the database sees it (a REAL query
 * builder, test/capturing-supabase.ts): the owner's favorites are joined in
 * the gallery's own query — an inner embed of `gallery_favorites` filtered on
 * the owner — on the page AND its count, beside every other gallery filter.
 * The favorite ids are never read, so the request is the same with none and
 * with thousands; it used to carry them all in `id=in.(…)`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CapturedRequest } from "../../test/capturing-supabase.js"

const cap = vi.hoisted(() => ({ requests: [] as CapturedRequest[], favoriteIds: [] as string[] }))

vi.mock("../supabase.js", async () => {
  const { capturingSupabase } = await import("../../test/capturing-supabase.js")
  const { client, requests } = capturingSupabase((req) => {
    if (req.url.pathname.endsWith("/gallery_favorites")) return { body: cap.favoriteIds.map((job_id) => ({ job_id })) }
    if (req.method === "HEAD") return { count: 2 }
    return { body: [] }
  })
  cap.requests = requests
  return { supabase: client }
})

const { readGalleryPage } = await import("../gallery-listing.js")
const { OWNER_VIEW_MODERATION } = await import("../gallery-moderation.js")

const OWNER = "00000000-0000-4000-8000-000000000001"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

beforeEach(() => {
  cap.requests.length = 0
  cap.favoriteIds = []
})

const read = (favoritesOf: string | null, type?: string) =>
  readGalleryPage({ limit: 20, type, userId: OWNER, favoritesOf, includePrivate: true, moderation: OWNER_VIEW_MODERATION })

const jobsRequests = () => cap.requests.filter((r) => r.url.pathname.endsWith("/jobs"))

describe("the gallery's favorites filter", () => {
  it("joins the owner's favorites on the page and the count, and reads no favorite ids", async () => {
    const page = await read(OWNER, "image")
    expect(page.totalCount).toBe(2)
    const reqs = jobsRequests()
    expect(reqs.map((r) => r.method).sort()).toEqual(["GET", "HEAD"])
    for (const r of reqs) {
      expect(r.url.searchParams.get("select")).toContain("gallery_favorites!gallery_favorites_job_id_fkey!inner(user_id)")
      expect(r.url.searchParams.get("gallery_favorites.user_id")).toBe(`eq.${OWNER}`)
      expect([...r.url.searchParams.keys()]).not.toContain("id")
    }
    expect(cap.requests.some((r) => r.url.pathname.endsWith("/gallery_favorites"))).toBe(false)
  })

  it("is the same request with no favorites and with 5,000 — under any gateway's URL limit", async () => {
    await read(OWNER)
    const none = cap.requests.map((r) => `${r.method} ${r.href}`)
    cap.requests.length = 0
    cap.favoriteIds = Array.from({ length: 5000 }, (_, n) => id(n + 1))
    await read(OWNER)
    expect(cap.requests.map((r) => `${r.method} ${r.href}`)).toEqual(none)
    for (const r of cap.requests) expect(r.href.length).toBeLessThan(2048)
  })

  it("the page and the count carry the same filters (one filter set), with and without favorites", async () => {
    for (const favoritesOf of [OWNER, null]) {
      cap.requests.length = 0
      await read(favoritesOf, "video")
      const [count, page] = [jobsRequests().find((r) => r.method === "HEAD")!, jobsRequests().find((r) => r.method === "GET")!]
      const filters = (r: CapturedRequest) =>
        [...r.url.searchParams.entries()].filter(([k]) => !["select", "order", "limit"].includes(k)).sort()
      expect(filters(page)).toEqual(filters(count))
      expect(filters(page).some(([k]) => k === "gallery_favorites.user_id")).toBe(favoritesOf !== null)
    }
  })

  it("without favoritesOnly the gallery names no favorites at all", async () => {
    await read(null)
    for (const r of jobsRequests()) expect(r.url.search).not.toContain("gallery_favorites")
  })
})
