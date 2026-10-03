import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// A 500 files an incident report in the background; keep it off the mocked table.
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => undefined) }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://t.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/saved-post-still.js", () => ({
  mirrorSavedPostStill: vi.fn(),
  deleteSavedPostStill: vi.fn(),
}))

import { savedPostRoutes, encodeSavedPostsCursor, parseSavedPostsCursor, searchWords } from "../saved-posts.js"
import { supabase } from "../../lib/supabase.js"
import { mirrorSavedPostStill, deleteSavedPostStill } from "../../lib/saved-post-still.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SAVE_ID = "00000000-0000-4000-8000-0000000000aa"
const ASSET_ID = "00000000-0000-4000-8000-0000000000bb"
const NEW_ASSET_ID = "00000000-0000-4000-8000-0000000000cc"
const STILL_URL = "https://media.example.com/uploads/images/a.jpg"
const MISSING_TABLE_CODES = ["42P01", "PGRST205"] as const

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/** Chainable + thenable query-builder mock; `single` / `maybeSingle` / await resolve to `result`. */
function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const qb: Record<string, unknown> = {}
  for (const name of ["select", "insert", "update", "delete", "eq", "is", "in", "or", "filter", "order", "limit"]) {
    qb[name] = vi.fn(() => qb)
  }
  qb.single = vi.fn(() => Promise.resolve(resolved))
  qb.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}

const fromMock = supabase.from as ReturnType<typeof vi.fn>
const mirrorMock = mirrorSavedPostStill as ReturnType<typeof vi.fn>
const deleteStillMock = deleteSavedPostStill as ReturnType<typeof vi.fn>

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "tiktok:7300000000000000001",
    platform: "tiktok",
    url: "https://www.tiktok.com/@maker/video/7300000000000000001",
    text: "Three ways to fold a shirt",
    author: { handle: "maker", name: "Maker" },
    metrics: { views: 1200 },
    media: { kind: "video", thumbnailUrl: "https://cdn.example.com/still.jpg" },
    hashtags: ["laundry"],
    extra: {},
    ...overrides,
  }
}

/** A stored save whose copied still still has its bytes. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: SAVE_ID,
    post_id: "tiktok:7300000000000000001",
    platform: "tiktok",
    url: "https://www.tiktok.com/@maker/video/7300000000000000001",
    post: post(),
    thumbnail_asset_id: ASSET_ID,
    thumbnail_url: STILL_URL,
    still: { r2_url: STILL_URL, r2_key: "uploads/images/a.jpg" },
    note: "",
    tags: [],
    source: "picker",
    created_at: "2026-10-02T10:00:00.123456+00:00",
    updated_at: "2026-10-02T10:00:00.123456+00:00",
    ...overrides,
  }
}

/** Saved without a still (the copy failed, or the asset was deleted). */
const NO_STILL = { thumbnail_asset_id: null, thumbnail_url: null, still: null }
/** The still's asset row survives a storage cleanup; its bytes do not. */
const DEAD_STILL = { still: { r2_url: null, r2_key: null } }

async function buildApp(opts: { user?: boolean; scopes?: string[] } = {}): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    if (opts.user !== false) (req as { userId?: string }).userId = USER
    if (opts.scopes) (req as { appAuthorization?: unknown }).appAuthorization = { scopes: opts.scopes }
  })
  await app.register(savedPostRoutes)
  return app
}

function encoded(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url")
}

beforeEach(() => vi.resetAllMocks())

describe("saved-posts helpers", () => {
  it("searchWords drops every character PostgREST or LIKE would read", () => {
    expect(searchWords(`  fold, (shirt) 100% "fast" a_b next.js  `)).toEqual(["fold", "shirt", "100", "fast", "a", "b", "next", "js"].slice(0, 5))
  })

  it("a cursor round-trips, time zone included, as url-safe text", () => {
    const cursor = encodeSavedPostsCursor({ created_at: "2026-10-02T10:00:00.123456+00:00", id: SAVE_ID })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(parseSavedPostsCursor(cursor)).toEqual({ createdAt: "2026-10-02T10:00:00.123456+00:00", id: SAVE_ID })
  })

  it("parseSavedPostsCursor accepts only a timestamp and a uuid it encoded", () => {
    expect(parseSavedPostsCursor(encoded("2026-10-02T10:00:00Z|not-a-uuid"))).toBeNull()
    expect(parseSavedPostsCursor(encoded(`2026-10-02),id.gt.0|${SAVE_ID}`))).toBeNull()
    expect(parseSavedPostsCursor(encoded(`2026-13-45T99:99:99Z|${SAVE_ID}`))).toBeNull()
    expect(parseSavedPostsCursor(`2026-10-02T10:00:00Z|${SAVE_ID}`)).toBeNull()
    expect(parseSavedPostsCursor("garbage")).toBeNull()
  })
})

describe("GET /v1/saved-posts", () => {
  it("lists the caller's saves, newest first, with a cursor when more remain", async () => {
    const qb = makeQB({ data: [row(), row({ id: "00000000-0000-4000-8000-0000000000ab" })] })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts?limit=1" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ id: SAVE_ID, postId: "tiktok:7300000000000000001", thumbnailUrl: STILL_URL })
    expect(parseSavedPostsCursor(body.nextCursor)).toEqual({ createdAt: row().created_at, id: SAVE_ID })
    expect(qb.select).toHaveBeenCalledWith(expect.stringContaining("still:assets!thumbnail_asset_id(r2_url, r2_key)"))
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(qb.limit).toHaveBeenCalledWith(2)
  })

  it("hands out the still's current link, and none once its bytes are gone", async () => {
    const moved = "https://media.example.com/uploads/images/moved.jpg"
    fromMock.mockReturnValue(
      makeQB({
        data: [
          row({ still: { r2_url: moved, r2_key: "uploads/images/moved.jpg" } }),
          row({ id: "00000000-0000-4000-8000-0000000000ab", ...DEAD_STILL }),
          row({ id: "00000000-0000-4000-8000-0000000000ac", ...NO_STILL }),
        ],
      }),
    )
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts" })
    expect(res.json().data.map((s: { thumbnailUrl: string | null }) => s.thumbnailUrl)).toEqual([moved, null, null])
  })

  it("filters by platform, tag, words and a cursor it gave out", async () => {
    const qb = makeQB({ data: [] })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    const cursor = encodeSavedPostsCursor({ created_at: "2026-10-02T10:00:00+02:00", id: SAVE_ID })
    const res = await app.inject({ method: "GET", url: `/v1/saved-posts?platform=reddit&tag=%23Hooks&q=fold&cursor=${cursor}` })

    expect(res.statusCode).toBe(200)
    expect(qb.eq).toHaveBeenCalledWith("platform", "reddit")
    expect(qb.filter).toHaveBeenCalledWith("tags", "cs", '{"hooks"}')
    expect(qb.or).toHaveBeenCalledWith("note.ilike.*fold*,post->>text.ilike.*fold*,post->>title.ilike.*fold*")
    expect(qb.or).toHaveBeenCalledWith(
      `created_at.lt.2026-10-02T10:00:00+02:00,and(created_at.eq.2026-10-02T10:00:00+02:00,id.lt.${SAVE_ID})`,
    )
  })

  it("reads a tag that is nothing once cleaned as no tag filter", async () => {
    const qb = makeQB({ data: [] })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    await app.inject({ method: "GET", url: `/v1/saved-posts?tag=${encodeURIComponent('#{"}')}` })
    expect(qb.filter).not.toHaveBeenCalled()
  })

  it("refuses a cursor it did not give out", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts?cursor=abc" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_cursor")
    expect(fromMock).not.toHaveBeenCalled()
  })

  it.each(MISSING_TABLE_CODES)("reads an empty wall while the table does not exist yet (%s)", async (code) => {
    fromMock.mockReturnValue(makeQB({ error: { code, message: "missing" } }))
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
  })

  it("refuses a caller without a user", async () => {
    const app = await buildApp({ user: false })
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts" })
    expect(res.statusCode).toBe(401)
  })

  it("needs the assets:read scope from an app token", async () => {
    const app = await buildApp({ scopes: ["assets:write"] })
    const res = await app.inject({ method: "GET", url: "/v1/saved-posts" })
    expect(res.statusCode).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe("POST /v1/saved-posts/lookup", () => {
  it("answers which of the asked posts are saved", async () => {
    const qb = makeQB({ data: [{ id: SAVE_ID, post_id: "tiktok:1" }] })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts/lookup", payload: { postIds: ["tiktok:1", "tiktok:2"] } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ saved: [{ postId: "tiktok:1", id: SAVE_ID }] })
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(qb.in).toHaveBeenCalledWith("post_id", ["tiktok:1", "tiktok:2"])
  })

  it.each(MISSING_TABLE_CODES)("answers nothing saved while the table does not exist yet (%s)", async (code) => {
    fromMock.mockReturnValue(makeQB({ error: { code } }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts/lookup", payload: { postIds: ["tiktok:1"] } })
    expect(res.json()).toEqual({ saved: [] })
  })

  it("needs the assets:read scope from an app token", async () => {
    const app = await buildApp({ scopes: ["assets:write"] })
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts/lookup", payload: { postIds: ["tiktok:1"] } })
    expect(res.statusCode).toBe(403)
  })
})

describe("POST /v1/saved-posts", () => {
  it("saves a new post with its copied still, scoped to the caller", async () => {
    const existing = makeQB({ data: null })
    const insert = makeQB({ data: row({ note: "hook idea", tags: ["hooks"] }) })
    fromMock.mockReturnValueOnce(existing).mockReturnValueOnce(insert)
    mirrorMock.mockResolvedValue({ assetId: ASSET_ID, url: STILL_URL })
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/saved-posts",
      payload: { post: post(), note: "hook idea", tags: ["#Hooks", "hooks", " "], source: "picker" },
    })

    expect(res.statusCode).toBe(201)
    expect(existing.eq).toHaveBeenCalledWith("user_id", USER)
    expect(mirrorMock).toHaveBeenCalledWith(USER, expect.objectContaining({ id: "tiktok:7300000000000000001" }))
    const inserted = (insert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({
      user_id: USER,
      post_id: "tiktok:7300000000000000001",
      platform: "tiktok",
      thumbnail_asset_id: ASSET_ID,
      thumbnail_url: STILL_URL,
      note: "hook idea",
      tags: ["hooks"],
      source: "picker",
    })
    expect(res.json()).toMatchObject({ id: SAVE_ID, note: "hook idea", tags: ["hooks"], thumbnailUrl: STILL_URL })
  })

  it("stores only the checked post: wrongly typed fields and unsafe links are dropped", async () => {
    const insert = makeQB({ data: row() })
    fromMock.mockReturnValueOnce(makeQB({ data: null })).mockReturnValueOnce(insert)
    mirrorMock.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/saved-posts",
      payload: {
        post: post({
          author: { handle: "maker", name: "Maker", avatarUrl: "data:image/png;base64,AAAA", followers: -3 },
          metrics: { views: "lots", likes: 5 },
          media: { kind: "hologram", thumbnailUrl: "javascript:alert(1)" },
          hashtags: ["ok", 7],
          extra: "not a record",
        }),
      },
    })

    expect(res.statusCode).toBe(201)
    const stored = ((insert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { post: Record<string, unknown> }).post
    expect(stored.author).toEqual({ handle: "maker", name: "Maker" })
    expect(stored.metrics).toEqual({ likes: 5 })
    expect(stored.media).toEqual({ kind: "text" })
    expect(stored.hashtags).toEqual(["ok"])
    expect(stored.extra).toEqual({})
    expect(mirrorMock).toHaveBeenCalledWith(USER, expect.objectContaining({ media: { kind: "text" } }))
  })

  it("refuses a post from a platform Social Search does not search", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post({ platform: "myspace" }) } })
    expect(res.statusCode).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("saves without a still when the copy fails", async () => {
    const insert = makeQB({ data: row(NO_STILL) })
    fromMock.mockReturnValueOnce(makeQB({ data: null })).mockReturnValueOnce(insert)
    mirrorMock.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(201)
    const inserted = (insert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({ thumbnail_asset_id: null, thumbnail_url: null, source: "api", note: "", tags: [] })
    expect(res.json().thumbnailUrl).toBeNull()
  })

  it("returns the existing save when the post is saved again with nothing new", async () => {
    fromMock.mockReturnValueOnce(makeQB({ data: row() }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(SAVE_ID)
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(mirrorMock).not.toHaveBeenCalled()
  })

  it("updates the note of an existing save, leaving its still alone", async () => {
    const update = makeQB({ data: row({ note: "new" }) })
    fromMock.mockReturnValueOnce(makeQB({ data: row() })).mockReturnValueOnce(update)
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post(), note: "new" } })
    expect(res.statusCode).toBe(200)
    const fields = (update.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(fields).toMatchObject({ note: "new" })
    expect(fields).not.toHaveProperty("thumbnail_asset_id")
    expect(update.eq).toHaveBeenCalledWith("user_id", USER)
    expect(update.is).not.toHaveBeenCalled()
    expect(mirrorMock).not.toHaveBeenCalled()
  })

  it("copies the still when a post saved without one is saved again, only if no other save set one", async () => {
    const update = makeQB({ data: row({ thumbnail_asset_id: NEW_ASSET_ID }) })
    fromMock.mockReturnValueOnce(makeQB({ data: row(NO_STILL) })).mockReturnValueOnce(update)
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(200)
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnail_asset_id: NEW_ASSET_ID, thumbnail_url: "https://media.example.com/b.jpg" }),
    )
    expect(update.is).toHaveBeenCalledWith("thumbnail_asset_id", null)
    expect(deleteStillMock).not.toHaveBeenCalled()
  })

  it("copies the still again when the stored copy's bytes were cleaned up", async () => {
    const update = makeQB({ data: row({ thumbnail_asset_id: NEW_ASSET_ID }) })
    fromMock.mockReturnValueOnce(makeQB({ data: row(DEAD_STILL) })).mockReturnValueOnce(update)
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(200)
    expect(update.eq).toHaveBeenCalledWith("thumbnail_asset_id", ASSET_ID)
    expect(deleteStillMock).toHaveBeenCalledWith(USER, ASSET_ID)
    expect(deleteStillMock).not.toHaveBeenCalledWith(USER, NEW_ASSET_ID)
  })

  it("drops its copy when another save set a still first, and still applies the note", async () => {
    const lost = makeQB({ data: null })
    const retry = makeQB({ data: row({ note: "new" }) })
    fromMock.mockReturnValueOnce(makeQB({ data: row(NO_STILL) })).mockReturnValueOnce(lost).mockReturnValueOnce(retry)
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post(), note: "new" } })

    expect(res.statusCode).toBe(200)
    expect(res.json().note).toBe("new")
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
    const fields = (retry.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(fields).toMatchObject({ note: "new" })
    expect(fields).not.toHaveProperty("thumbnail_asset_id")
  })

  it("answers the current save when another save set a still first and nothing else changed", async () => {
    fromMock
      .mockReturnValueOnce(makeQB({ data: row(NO_STILL) }))
      .mockReturnValueOnce(makeQB({ data: null }))
      .mockReturnValueOnce(makeQB({ data: row() }))
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: SAVE_ID, thumbnailUrl: STILL_URL })
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
  })

  it("answers 409 when the save disappears while saving", async () => {
    fromMock
      .mockReturnValueOnce(makeQB({ data: row(NO_STILL) }))
      .mockReturnValueOnce(makeQB({ data: null }))
      .mockReturnValueOnce(makeQB({ data: null }))
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("conflict")
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
  })

  it("answers with the winning save when a second save raced it, dropping its own still", async () => {
    fromMock
      .mockReturnValueOnce(makeQB({ data: null }))
      .mockReturnValueOnce(makeQB({ error: { code: "23505", message: "dup" } }))
      .mockReturnValueOnce(makeQB({ data: row() }))
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(SAVE_ID)
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
    expect(fromMock).toHaveBeenCalledTimes(3)
  })

  it("applies its note to the winning save of a race", async () => {
    const update = makeQB({ data: row({ note: "mine" }) })
    fromMock
      .mockReturnValueOnce(makeQB({ data: null }))
      .mockReturnValueOnce(makeQB({ error: { code: "23505", message: "dup" } }))
      .mockReturnValueOnce(makeQB({ data: row() }))
      .mockReturnValueOnce(update)
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post(), note: "mine" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().note).toBe("mine")
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ note: "mine" }))
    expect(mirrorMock).toHaveBeenCalledTimes(1)
  })

  it("drops its still when the save fails", async () => {
    fromMock.mockReturnValueOnce(makeQB({ data: null })).mockReturnValueOnce(makeQB({ error: { code: "XX000", message: "boom" } }))
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(500)
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
  })

  it("refuses something that is not a post", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: { id: "x" } } })
    expect(res.statusCode).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("refuses a post snapshot that is far too large", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post({ extra: { blob: "x".repeat(70_000) } }) } })
    expect(res.statusCode).toBe(413)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it.each(MISSING_TABLE_CODES)("answers 503 while the table does not exist yet (%s)", async (code) => {
    fromMock.mockReturnValueOnce(makeQB({ error: { code } }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("drops its still and answers 503 when the table is missing at insert time", async () => {
    fromMock.mockReturnValueOnce(makeQB({ data: null })).mockReturnValueOnce(makeQB({ error: { code: "PGRST205" } }))
    mirrorMock.mockResolvedValue({ assetId: NEW_ASSET_ID, url: "https://media.example.com/b.jpg" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(503)
    expect(deleteStillMock).toHaveBeenCalledWith(USER, NEW_ASSET_ID)
  })

  it("needs the assets:write scope from an app token", async () => {
    const app = await buildApp({ scopes: ["assets:read"] })
    const res = await app.inject({ method: "POST", url: "/v1/saved-posts", payload: { post: post() } })
    expect(res.statusCode).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe("PATCH and DELETE /v1/saved-posts/:id", () => {
  it("updates the caller's own save", async () => {
    const qb = makeQB({ data: row({ tags: ["hooks"] }) })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: `/v1/saved-posts/${SAVE_ID}`, payload: { tags: ["Hooks"] } })
    expect(res.statusCode).toBe(200)
    expect(qb.update).toHaveBeenCalledWith(expect.objectContaining({ tags: ["hooks"] }))
    expect(qb.eq).toHaveBeenCalledWith("id", SAVE_ID)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(res.json().thumbnailUrl).toBe(STILL_URL)
  })

  it("refuses an update with nothing in it", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: `/v1/saved-posts/${SAVE_ID}`, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it("answers 404 for a save that is not the caller's", async () => {
    fromMock.mockReturnValue(makeQB({ data: null }))
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: `/v1/saved-posts/${SAVE_ID}`, payload: { note: "x" } })
    expect(res.statusCode).toBe(404)
  })

  it.each(MISSING_TABLE_CODES)("answers 503 to an update or a delete while the table does not exist yet (%s)", async (code) => {
    fromMock.mockReturnValue(makeQB({ error: { code } }))
    const app = await buildApp()
    const patched = await app.inject({ method: "PATCH", url: `/v1/saved-posts/${SAVE_ID}`, payload: { note: "x" } })
    const deleted = await app.inject({ method: "DELETE", url: `/v1/saved-posts/${SAVE_ID}` })
    expect(patched.statusCode).toBe(503)
    expect(deleted.statusCode).toBe(503)
  })

  it("deletes a save and its still", async () => {
    const qb = makeQB({ data: { id: SAVE_ID, thumbnail_asset_id: ASSET_ID } })
    fromMock.mockReturnValue(qb)
    const app = await buildApp()
    const res = await app.inject({ method: "DELETE", url: `/v1/saved-posts/${SAVE_ID}` })
    expect(res.statusCode).toBe(200)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(deleteStillMock).toHaveBeenCalledWith(USER, ASSET_ID)
  })

  it("answers 404 when there is nothing to delete", async () => {
    fromMock.mockReturnValue(makeQB({ data: null }))
    const app = await buildApp()
    const res = await app.inject({ method: "DELETE", url: `/v1/saved-posts/${SAVE_ID}` })
    expect(res.statusCode).toBe(404)
    expect(deleteStillMock).not.toHaveBeenCalled()
  })

  it("refuses an id that is not a uuid", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "DELETE", url: "/v1/saved-posts/abc" })
    expect(res.statusCode).toBe(400)
  })
})
