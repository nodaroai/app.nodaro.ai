/**
 * PATCH /v1/jobs/:id — the owner names their job or clears its name. The
 * database side is proven in lib/__tests__/job-title.test.ts; this pins the
 * route's wiring: who may, what a bad name answers, and that the name then
 * passes every job read's allowlist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/job-update.js", () => ({ updateJobOwnerFields: vi.fn() }))
vi.mock("@/lib/fetch-own-media.js", () => ({ isOwnMediaUrl: (u: string) => u.startsWith("https://cdn.test/") }))
vi.mock("@/lib/job-title.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/job-title.js")>()
  return { ...actual, setJobTitle: vi.fn() }
})

import { registerJobTitleRoute } from "../job-title.js"
import { PUBLIC_JOB_KEYS, sanitizeJobForPublic, type JobRecord } from "../jobs.js"
import { SESSION_FEED_JOB_COLS, sessionFeedJobCols } from "../../lib/generation-sessions.js"
import { setJobTitle } from "../../lib/job-title.js"
import { setTitleColumnPresentForTests } from "../../lib/jobs-title-column.js"
import { setCoverColumnPresentForTests } from "../../lib/jobs-cover-column.js"
import { updateJobOwnerFields } from "../../lib/job-update.js"
import { toSharedJob } from "../../lib/share-links/shared-job.js"
import { embeddedJobCover } from "../../lib/job-cover/library-embed.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000c1"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Test identity from the query: `__userId`, an admin role, and OAuth-app scopes.
  app.addHook("onRequest", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q.__userId) req.userId = q.__userId
    if (q.__admin) req.userRole = "admin"
    if (q.__scopes !== undefined) {
      ;(req as { appAuthorization?: unknown }).appAuthorization = {
        appId: "app1",
        authorizationId: "auth1",
        scopes: q.__scopes ? q.__scopes.split(",") : [],
      }
    }
  })
  await app.register(async (instance) => {
    registerJobTitleRoute(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const rename = async (query: string, body: object, id = JOB) => {
  const res = await app.inject({ method: "PATCH", url: `/v1/jobs/${id}?${query}`, payload: body })
  return res
}

describe("PATCH /v1/jobs/:id", () => {
  it("the owner names the job: trimmed, and answered as the job's name now", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: "Wedding toast, final" })
    const res = await rename(`__userId=${OWNER}`, { title: "  Wedding toast, final  " })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { jobId: JOB, title: "Wedding toast, final" } })
    expect(setJobTitle).toHaveBeenCalledWith(OWNER, JOB, "Wedding toast, final")
  })

  it("null clears the name, and so does an empty string", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: null })
    expect((await rename(`__userId=${OWNER}`, { title: null })).json()).toEqual({ data: { jobId: JOB, title: null } })
    expect((await rename(`__userId=${OWNER}`, { title: "" })).statusCode).toBe(200)
    expect(vi.mocked(setJobTitle).mock.calls.map((c) => c[2])).toEqual([null, null])
  })

  it("a name over 120 characters, or one that is not one line of plain text, is a 400 — nothing is written", async () => {
    const long = await rename(`__userId=${OWNER}`, { title: "x".repeat(121) })
    expect(long.statusCode).toBe(400)
    expect(long.json().error).toMatchObject({ code: "validation_error", message: expect.stringContaining("120") })
    const multiline = await rename(`__userId=${OWNER}`, { title: "two\nlines" })
    expect(multiline.statusCode).toBe(400)
    expect(multiline.json().error.message).toContain("plain text")
    const missing = await rename(`__userId=${OWNER}`, {})
    expect(missing.statusCode).toBe(400)
    const wrongType = await rename(`__userId=${OWNER}`, { title: 7 })
    expect(wrongType.statusCode).toBe(400)
    expect(setJobTitle).not.toHaveBeenCalled()
  })

  it("someone else's job is 404 — an admin's request included — and so is an id that cannot be a job", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "not_found" })
    expect((await rename(`__userId=${OTHER}`, { title: "Mine now" })).statusCode).toBe(404)
    expect(setJobTitle).toHaveBeenLastCalledWith(OTHER, JOB, "Mine now")
    expect((await rename(`__userId=${OTHER}&__admin=1`, { title: "Mine now" })).statusCode).toBe(404)
    expect((await rename(`__userId=${OWNER}`, { title: "x" }, "not-a-uuid")).statusCode).toBe(404)
  })

  it("needs a signed-in caller, and an OAuth app needs assets:write", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: "x" })
    expect((await rename("", { title: "x" })).statusCode).toBe(401)
    expect((await rename(`__userId=${OWNER}&__scopes=jobs:read`, { title: "x" })).statusCode).toBe(403)
    expect((await rename(`__userId=${OWNER}&__scopes=assets:write`, { title: "x" })).statusCode).toBe(200)
  })

  it("a database failure is a 500, never a silent success", async () => {
    vi.mocked(setJobTitle).mockRejectedValue(new Error("db down"))
    expect((await rename(`__userId=${OWNER}`, { title: "x" })).statusCode).toBe(500)
  })

  it("before the column reaches this database, naming is 503 not_available — never a silent success", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "not_available" })
    const res = await rename(`__userId=${OWNER}`, { title: "x" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })
})

describe("the name reaches every job read", () => {
  it("is on the public allowlist, so GET /v1/jobs/:id, the list and the Trash answer it", () => {
    expect(PUBLIC_JOB_KEYS).toContain("title")
    const job = { id: JOB, status: "completed", user_id: OWNER, title: "Hero shot v2" } as unknown as JobRecord
    expect((sanitizeJobForPublic(job, false) as { title?: string | null }).title).toBe("Hero shot v2")
    expect((sanitizeJobForPublic({ ...job, title: null }, false) as { title?: string | null }).title).toBeNull()
  })

  it("is selected for a session's items (and the Trash, which reads the same columns) once the database has the column", () => {
    setTitleColumnPresentForTests(true)
    expect(sessionFeedJobCols().split(", ")).toContain("title")
    // Before migration 609 reaches the database (staging reads the shared one),
    // the feed names every other column and not this one, so it still answers.
    setTitleColumnPresentForTests(false)
    expect(sessionFeedJobCols()).toBe(SESSION_FEED_JOB_COLS)
    expect(SESSION_FEED_JOB_COLS.split(", ")).not.toContain("title")
  })
})

describe("PATCH /v1/jobs/:id — the cover (decided 2026-11-23)", () => {
  const COVER = `https://cdn.test/job-covers/${OWNER}/cover-1.png`

  it("the owner sets a cover by asset id or by address; the answer is the picture now", async () => {
    vi.mocked(updateJobOwnerFields).mockResolvedValue({ kind: "ok", coverUrl: COVER })
    const byAsset = await rename(`__userId=${OWNER}`, { cover: { assetId: "00000000-0000-4000-8000-0000000000aa" } })
    expect(byAsset.statusCode).toBe(200)
    expect(byAsset.json()).toEqual({ data: { jobId: JOB, coverUrl: COVER } })
    expect(updateJobOwnerFields).toHaveBeenLastCalledWith(OWNER, JOB, { cover: { assetId: "00000000-0000-4000-8000-0000000000aa" } })
    expect((await rename(`__userId=${OWNER}`, { cover: { url: "https://cdn.test/uploads/a.png" } })).statusCode).toBe(200)
    expect(setJobTitle).not.toHaveBeenCalled()
  })

  it("a name and a cover together, in one change; null clears the cover", async () => {
    vi.mocked(updateJobOwnerFields).mockResolvedValue({ kind: "ok", title: "Mine", coverUrl: null })
    const res = await rename(`__userId=${OWNER}`, { title: " Mine ", cover: null })
    expect(res.json()).toEqual({ data: { jobId: JOB, title: "Mine", coverUrl: null } })
    expect(updateJobOwnerFields).toHaveBeenLastCalledWith(OWNER, JOB, { title: "Mine", cover: null })
  })

  it("anything but one of the caller's images here is a 400 before anything is read", async () => {
    for (const cover of [{ url: "https://evil.example/a.png" }, { url: "ftp://cdn.test/a.png" }, { assetId: "not-a-uuid" }, { both: 1 }, "https://cdn.test/a.png", { url: "https://cdn.test/a.png", assetId: "00000000-0000-4000-8000-0000000000aa" }]) {
      expect((await rename(`__userId=${OWNER}`, { cover })).statusCode, JSON.stringify(cover)).toBe(400)
    }
    expect(updateJobOwnerFields).not.toHaveBeenCalled()
  })

  it("a picture the check refuses answers its reason; someone else's job is 404; a missing column is 503", async () => {
    vi.mocked(updateJobOwnerFields).mockResolvedValueOnce({ kind: "invalid_cover", problem: "wrong_size" })
    const bad = await rename(`__userId=${OWNER}`, { cover: { url: "https://cdn.test/a.png" } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.message).toContain("pixels")
    vi.mocked(updateJobOwnerFields).mockResolvedValueOnce({ kind: "not_found" })
    expect((await rename(`__userId=${OTHER}`, { cover: null })).statusCode).toBe(404)
    vi.mocked(updateJobOwnerFields).mockResolvedValueOnce({ kind: "not_available", field: "cover" })
    const later = await rename(`__userId=${OWNER}`, { cover: null })
    expect(later.statusCode).toBe(503)
    expect(later.json().error.code).toBe("not_available")
  })

  it("a change that lost the race to another cover change is 409 conflict", async () => {
    vi.mocked(updateJobOwnerFields).mockResolvedValueOnce({ kind: "conflict" })
    const res = await rename(`__userId=${OWNER}`, { cover: null })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("conflict")
  })

  it("a cover address over 2048 characters is a 400 before anything is read", async () => {
    const long = `https://cdn.test/${"a".repeat(2050)}.png`
    expect((await rename(`__userId=${OWNER}`, { cover: { url: long } })).statusCode).toBe(400)
    expect(updateJobOwnerFields).not.toHaveBeenCalled()
  })

  it("a change over the cover's own limit is 429 rate_limit_exceeded, with when to retry", async () => {
    vi.mocked(updateJobOwnerFields).mockResolvedValueOnce({ kind: "rate_limited", retryAfterSec: 37 })
    const res = await rename(`__userId=${OWNER}`, { cover: null })
    expect(res.statusCode).toBe(429)
    expect(res.headers["retry-after"]).toBe("37")
    expect(res.json().error.code).toBe("rate_limit_exceeded")
  })

  it("an OAuth app needs assets:write for the cover too", async () => {
    expect((await rename(`__userId=${OWNER}&__scopes=jobs:read`, { cover: null })).statusCode).toBe(403)
  })
})

describe("the picture reaches every job read, as coverUrl", () => {
  const SUNO_ART = "https://musicfile.example/art.jpeg"
  const MINE = "https://cdn.test/job-covers/x/cover-1.png"
  const job = { id: JOB, status: "completed", user_id: OWNER, output_data: { audioUrl: "https://cdn.test/a.mp3", sunoImageUrl: SUNO_ART } } as unknown as JobRecord

  it("GET /v1/jobs/:id, the list and the Trash: the owner's cover, else the provider's art, else null — the stored column itself never", () => {
    const withCover = sanitizeJobForPublic({ ...job, cover_url: MINE }, false) as Record<string, unknown>
    expect(withCover.coverUrl).toBe(MINE)
    expect(withCover).not.toHaveProperty("cover_url")
    expect((sanitizeJobForPublic(job, false) as Record<string, unknown>).coverUrl).toBe(SUNO_ART)
    expect((sanitizeJobForPublic({ ...job, output_data: { imageUrl: "https://cdn.test/i.png" } }, false) as Record<string, unknown>).coverUrl).toBeNull()
  })

  it("a session's items select the column once the database has it", () => {
    setTitleColumnPresentForTests(false)
    setCoverColumnPresentForTests(true)
    expect(sessionFeedJobCols().split(", ")).toContain("cover_url")
    setCoverColumnPresentForTests(false)
    expect(sessionFeedJobCols()).toBe(SESSION_FEED_JOB_COLS)
  })

  it("a share: the owner's cover, else the provider's art", () => {
    const row = { id: JOB, status: "completed", input_data: { type: "suno-generate" }, output_data: { audioUrl: "https://cdn.test/a.mp3", sunoImageUrl: SUNO_ART }, created_at: "2026-11-23T00:00:00Z" }
    expect(toSharedJob({ ...row, cover_url: MINE }, { allowCopy: false })?.coverUrl).toBe(MINE)
    expect(toSharedJob(row, { allowCopy: false })?.coverUrl).toBe(SUNO_ART)
  })

  it("the library's rows: through the file's job", () => {
    expect(embeddedJobCover({ cover_url: MINE, sunoImageUrl: SUNO_ART })).toBe(MINE)
    expect(embeddedJobCover([{ cover_url: null, sunoImageUrl: SUNO_ART }])).toBe(SUNO_ART)
    expect(embeddedJobCover(null)).toBeNull()
  })
})
