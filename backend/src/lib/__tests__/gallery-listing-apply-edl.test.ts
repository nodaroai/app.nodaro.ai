/**
 * Apply EDL renders in the gallery listing (decided 2026-10-06): the OWNER's own
 * view lists them (a Preview marked), the public gallery never does.
 *
 * A Preview is `force_private`, so the public query's `is_public` gate already
 * hides it; but a FINAL by a user whose outputs are public is `is_public` too,
 * and listing it publicly would be new exposure nobody has decided. So the
 * public listing never names Apply EDL at all — whatever the rows say.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { supabase } = await import("../supabase.js")
const { readGalleryPage } = await import("../gallery-listing.js")
const { OWNER_VIEW_MODERATION } = await import("../gallery-moderation.js")

const OWNER = "00000000-0000-4000-8000-000000000001"

interface Call { method: string; args: unknown[] }

function recorder(rows: unknown[]) {
  const calls: Call[] = []
  const result = { data: rows, error: null, count: rows.length }
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args })
        return proxy
      }
    },
  })
  vi.mocked(supabase.from).mockReturnValue(proxy as never)
  return calls
}

const edl = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  job_type: "apply-edl",
  user_id: OWNER,
  input_data: { quality: "proxy", output: "video" },
  output_data: { videoUrl: `https://r2/${id}.mp4`, thumbnailUrl: `https://r2/${id}.jpg` },
  completed_at: "2026-10-06T10:00:00Z",
  provider: null,
  ...over,
})

/** Every job_type the listing asked the database for, across .in() and .or(). */
const askedTypes = (calls: Call[]): string => JSON.stringify(calls.filter((c) => c.method === "in" || c.method === "or").map((c) => c.args))

beforeEach(() => vi.clearAllMocks())

describe("the owner's own gallery view lists Apply EDL renders", () => {
  const owner = (type?: string) => ({ limit: 20, type, userId: OWNER, includePrivate: true, moderation: OWNER_VIEW_MODERATION })

  it("asks for them, and marks a proxy render a Preview — a final carries no marker", async () => {
    const calls = recorder([edl("p1"), edl("f1", { input_data: { quality: "final" } })])
    const page = await readGalleryPage(owner())
    expect(askedTypes(calls)).toContain("apply-edl")
    const [p, f] = page.rows.map((r) => r.item)
    expect(p).toMatchObject({ id: "p1", type: "video", outputUrl: "https://r2/p1.mp4", jobName: "apply-edl", preview: true })
    expect(f?.id).toBe("f1")
    expect(f).not.toHaveProperty("preview")
  })

  it("fills the marker of an old render from its order, and lists an audio mix as audio", async () => {
    recorder([edl("old", { output_data: { videoUrl: "https://r2/old.mp4" } }), edl("mix", { input_data: { quality: "final", output: "audio" }, output_data: { audioUrl: "https://r2/mix.m4a" } })])
    const page = await readGalleryPage(owner())
    expect(page.rows.map((r) => [r.item.id, r.item.type, r.item.preview ?? false])).toEqual([["old", "video", true], ["mix", "audio", false]])
  })

  it("a type filter lists only the renders of that medium", async () => {
    const rows = [edl("v1"), edl("a1", { input_data: { quality: "final", output: "audio" }, output_data: { audioUrl: "https://r2/a1.m4a" } })]
    recorder(rows)
    expect((await readGalleryPage(owner("video"))).rows.map((r) => r.item.id)).toEqual(["v1"])
    recorder(rows)
    expect((await readGalleryPage(owner("audio"))).rows.map((r) => r.item.id)).toEqual(["a1"])
    recorder(rows)
    expect((await readGalleryPage(owner("image"))).rows).toEqual([])
  })

  it("an image filter never asks for them", async () => {
    const calls = recorder([])
    await readGalleryPage(owner("image"))
    expect(askedTypes(calls)).not.toContain("apply-edl")
  })
})

describe("the public gallery never lists an Apply EDL render", () => {
  const pub = (over: Record<string, unknown> = {}) => ({ limit: 20, includePrivate: false, moderation: OWNER_VIEW_MODERATION, ...over })

  it("does not ask for them, keeps the is_public gate, and drops one a row hands it anyway", async () => {
    const calls = recorder([edl("p1"), edl("f1", { input_data: { quality: "final" } })])
    const page = await readGalleryPage(pub())
    expect(askedTypes(calls)).not.toContain("apply-edl")
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "is_public" && c.args[1] === true)).toBe(true)
    expect(page.rows).toEqual([])
  })

  it("not for a typed request, not for someone's page, not for their favorites", async () => {
    for (const q of [pub({ type: "video" }), pub({ type: "audio" }), pub({ userId: OWNER }), pub({ userId: OWNER, favoriteJobIds: ["p1", "f1"] })]) {
      const calls = recorder([edl("p1"), edl("f1", { input_data: { quality: "final" } })])
      const page = await readGalleryPage(q)
      expect(askedTypes(calls), JSON.stringify(q)).not.toContain("apply-edl")
      expect(page.rows, JSON.stringify(q)).toEqual([])
    }
  })

  it("an owner-flagged read with no owner named is still the public one (the admin grid reads that way)", async () => {
    const calls = recorder([edl("p1")])
    const page = await readGalleryPage({ limit: 20, includePrivate: true, moderation: OWNER_VIEW_MODERATION })
    expect(askedTypes(calls)).not.toContain("apply-edl")
    expect(page.rows).toEqual([])
  })

  it("and never another person's render in the owner view", async () => {
    recorder([edl("theirs", { user_id: "someone-else" })])
    const page = await readGalleryPage({ limit: 20, userId: OWNER, includePrivate: true, moderation: OWNER_VIEW_MODERATION })
    expect(page.rows).toEqual([])
  })
})
