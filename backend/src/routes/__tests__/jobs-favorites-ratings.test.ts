/**
 * Favorites, ratings and the list filters on the jobs routes:
 *   - PUT /v1/jobs/:id/rating — the owner rates their job good/bad or clears it.
 *   - GET /v1/jobs — status (one or many), type (one or many), favorited, rating.
 *   - GET /v1/jobs and GET /v1/jobs/:id stamp every job with the owner's
 *     `favorited` and `rating`, from ONE read per table per response.
 *
 * The database side of each piece is proven in its own module's tests
 * (job-ratings, job-owner-state, job-list-filters); these pin the wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/job-owner-state.js")>()
  return { ...actual, jobOwnerStateFor: vi.fn(async () => new Map()) }
})
vi.mock("@/lib/job-ratings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/job-ratings.js")>()
  return { ...actual, setJobRating: vi.fn() }
})

import { jobRoutes } from "../jobs.js"
import { jobRatingRoutes } from "../job-ratings.js"
import { supabase } from "../../lib/supabase.js"
import { jobOwnerStateFor } from "../../lib/job-owner-state.js"
import { setJobRating } from "../../lib/job-ratings.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000c1"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(jobOwnerStateFor).mockResolvedValue(new Map())
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
    await jobRoutes(instance)
    await jobRatingRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function listedJob(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "completed",
    progress: 100,
    input_data: { type: "generate-image" },
    output_data: { imageUrl: `https://r2/${id}.png` },
    error_message: null,
    created_at: `2026-10-15T00:00:0${id.slice(-1)}Z`,
    started_at: null,
    completed_at: null,
    user_id: OWNER,
    credits: 1,
    job_type: "generate-image",
    workflow_execution_id: null,
    workflow_executions: null,
    ...over,
  }
}

/** The LIST query: records every call; answers the rows (or an error). */
function seedList(rows: Array<Record<string, unknown>>, error: unknown = null) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(error ? { data: null, error } : { data: rows, error: null })
          }
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args })
            return proxy
          }
        },
      },
    )
    return proxy as never
  })
  return calls
}

const list = (qs: string) => app.inject({ method: "GET", url: `/v1/jobs?__userId=${OWNER}${qs}` })

describe("PUT /v1/jobs/:id/rating", () => {
  const rate = (body: unknown, qs = `__userId=${OWNER}`, id = JOB) =>
    app.inject({ method: "PUT", url: `/v1/jobs/${id}/rating?${qs}`, payload: body as never })

  it("rates the caller's job and answers { data: { jobId, rating } }", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "ok", rating: "good" })

    const res = await rate({ rating: "good" })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { jobId: JOB, rating: "good" } })
    expect(setJobRating).toHaveBeenCalledWith(OWNER, JOB, "good")
  })

  it("clears the rating with null", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "ok", rating: null })

    const res = await rate({ rating: null })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { jobId: JOB, rating: null } })
    expect(setJobRating).toHaveBeenCalledWith(OWNER, JOB, null)
  })

  it("refuses an anonymous caller", async () => {
    const res = await rate({ rating: "good" }, "")
    expect(res.statusCode).toBe(401)
    expect(setJobRating).not.toHaveBeenCalled()
  })

  it("an OAuth app needs assets:write (jobs:read is not enough)", async () => {
    const refused = await rate({ rating: "good" }, `__userId=${OWNER}&__scopes=jobs:read`)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:write" })
    expect(setJobRating).not.toHaveBeenCalled()

    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "ok", rating: "bad" })
    const allowed = await rate({ rating: "bad" }, `__userId=${OWNER}&__scopes=assets:write`)
    expect(allowed.statusCode).toBe(200)
  })

  it("validates the body: a rating outside good | bad, or none at all, is a 400", async () => {
    for (const body of [{ rating: "meh" }, {}, { rating: 1 }]) {
      const res = await rate(body)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(setJobRating).not.toHaveBeenCalled()
  })

  it("a job that is not the caller's — or an id that cannot be a job — is a 404", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "not_found" })
    const notTheirs = await rate({ rating: "good" }, `__userId=${OTHER}`)
    expect(notTheirs.statusCode).toBe(404)
    expect(notTheirs.json().error.code).toBe("not_found")

    const notAnId = await rate({ rating: "good" }, `__userId=${OWNER}`, "not-a-uuid")
    expect(notAnId.statusCode).toBe(404)
    expect(setJobRating).toHaveBeenCalledTimes(1)
  })

  it("an admin rates only their own jobs too — the rating is the owner's", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "not_found" })
    const res = await rate({ rating: "good" }, `__userId=${OTHER}&__admin=1`)
    expect(res.statusCode).toBe(404)
    expect(setJobRating).toHaveBeenCalledWith(OTHER, JOB, "good")
  })

  it("answers 503 not_available while ratings are not in this database yet", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "not_available" })
    const res = await rate({ rating: "good" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("a database failure is a sanitized 500", async () => {
    vi.mocked(setJobRating).mockRejectedValueOnce(Object.assign(new Error("relation job_ratings timeout"), { code: "57014" }))
    const res = await rate({ rating: "good" })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to rate job" } })
  })
})

describe("GET /v1/jobs — status and type, one or many", () => {
  it("several statuses (comma-separated) are one `in` on the status column", async () => {
    const calls = seedList([])
    const res = await list("&status=failed,cancelled")
    expect(res.statusCode).toBe(200)
    expect(calls).toContainEqual({ method: "in", args: ["status", ["failed", "cancelled"]] })
  })

  it("one status is an eq", async () => {
    const calls = seedList([])
    await list("&status=pending_review")
    expect(calls).toContainEqual({ method: "eq", args: ["status", "pending_review"] })
  })

  it("a repeated type (type=a&type=b) is one `in` on input_data.type", async () => {
    const calls = seedList([])
    const res = await list("&type=generate-image&type=generate-video")
    expect(res.statusCode).toBe(200)
    expect(calls).toContainEqual({ method: "in", args: ["input_data->>type", ["generate-image", "generate-video"]] })
    expect(calls.filter((c) => c.args[0] === "job_type")).toEqual([])
  })

  it("an unknown status is a 400, before any query", async () => {
    const calls = seedList([])
    const res = await list("&status=running")
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error" })
    expect(res.json().error.message).toMatch(/^status/)
    expect(calls).toEqual([])
  })

  it("an unknown rating or a favorited that is not true/false is a 400", async () => {
    seedList([])
    expect((await list("&rating=meh")).statusCode).toBe(400)
    expect((await list("&favorited=yes")).statusCode).toBe(400)
  })
})

describe("GET /v1/jobs — favorited and rating filters", () => {
  const selected = (calls: Array<{ method: string; args: unknown[] }>) =>
    calls.filter((c) => c.method === "select").map((c) => String(c.args[0]))

  it("favorited=true inner-joins the owner's favorites by their foreign key", async () => {
    const calls = seedList([])
    const res = await list("&favorited=true")
    expect(res.statusCode).toBe(200)
    const [select] = selected(calls)
    expect(select).toContain("gallery_favorites!gallery_favorites_job_id_fkey!inner(job_id)")
    expect(calls).toContainEqual({ method: "eq", args: ["gallery_favorites.user_id", OWNER] })
  })

  it("rating=good inner-joins the owner's ratings and narrows to good", async () => {
    const calls = seedList([])
    await list("&rating=good")
    expect(selected(calls)[0]).toContain("job_ratings!job_ratings_job_id_fkey!inner(rating)")
    expect(calls).toContainEqual({ method: "eq", args: ["job_ratings.user_id", OWNER] })
    expect(calls).toContainEqual({ method: "eq", args: ["job_ratings.rating", "good"] })
  })

  it("rating=unrated keeps the jobs with no rating (left embed + is null)", async () => {
    const calls = seedList([])
    await list("&rating=unrated")
    expect(selected(calls)[0]).toContain("job_ratings!job_ratings_job_id_fkey(rating)")
    expect(calls).toContainEqual({ method: "is", args: ["job_ratings", null] })
  })

  it("an admin's ?userId= listing filters on THAT user's favorites — the jobs' owner", async () => {
    const calls = seedList([])
    await app.inject({ method: "GET", url: `/v1/jobs?__userId=${OTHER}&__admin=1&userId=${OWNER}&favorited=true` })
    expect(calls).toContainEqual({ method: "eq", args: ["gallery_favorites.user_id", OWNER] })
  })

  it("the select is unchanged when no filter needs an embed", async () => {
    const calls = seedList([])
    await list("&status=failed&type=llm-structured&origin=studio")
    const [select] = selected(calls)
    expect(select).not.toContain("gallery_favorites")
    expect(select).not.toContain("job_ratings")
  })

  it("answers 503 not_available when a rating filter meets a database without ratings yet", async () => {
    seedList([], { code: "PGRST200", message: "Could not find a relationship between 'jobs' and 'job_ratings'" })
    const res = await list("&rating=rated")
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("the same failure without a rating filter is still a server error", async () => {
    seedList([], { code: "PGRST200", message: "Could not find a relationship between 'jobs' and 'job_ratings' in the schema cache" })
    const res = await list("&favorited=true")
    expect(res.statusCode).toBe(500)
  })

  it("a broken FAVORITES embed beside a rating filter is a server error, never 'ratings not available'", async () => {
    seedList([], {
      code: "PGRST200",
      message: "Could not find a relationship between 'jobs' and 'gallery_favorites' in the schema cache",
      details: "Searched for a foreign key relationship between 'jobs' and 'gallery_favorites' using the hint 'gallery_favorites_job_id_fkey' in the schema 'public', but no matches were found.",
      hint: "Perhaps you meant 'job_ratings' instead of 'gallery_favorites'.",
    })
    const res = await list("&favorited=true&rating=good")
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to list jobs" } })
  })

  it("the joined embeds never reach the wire, and the page still advances off the raw last row", async () => {
    seedList([
      listedJob("j1", { gallery_favorites: [{ job_id: "j1" }] }),
      listedJob("j2", { gallery_favorites: [{ job_id: "j2" }] }),
    ])
    const res = await list("&favorited=true&limit=2")
    const body = res.json()
    expect(JSON.stringify(body)).not.toContain("gallery_favorites")
    expect(body.next).toBe("2026-10-15T00:00:02Z")
  })
})

describe("favorited and rating on every listed job", () => {
  it("GET /v1/jobs stamps each job from ONE owner-state read for the page", async () => {
    seedList([listedJob("j1"), listedJob("j2"), listedJob("j3")])
    vi.mocked(jobOwnerStateFor).mockResolvedValueOnce(
      new Map([
        ["j1", { favorited: true, rating: "good" as const }],
        ["j2", { favorited: false, rating: "bad" as const }],
      ]),
    )

    const res = await list("")

    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(
      (res.json().data as Array<{ id: string; favorited: boolean; rating: string | null }>).map((j) => [j.id, [j.favorited, j.rating]]),
    )
    expect(byId).toEqual({ j1: [true, "good"], j2: [false, "bad"], j3: [false, null] })
    expect(jobOwnerStateFor).toHaveBeenCalledTimes(1)
    expect(jobOwnerStateFor).toHaveBeenCalledWith(OWNER, ["j1", "j2", "j3"])
  })

  it("an admin listing another user's jobs reads THAT user's state", async () => {
    seedList([listedJob("j1")])
    await app.inject({ method: "GET", url: `/v1/jobs?__userId=${OTHER}&__admin=1&userId=${OWNER}` })
    expect(jobOwnerStateFor).toHaveBeenCalledWith(OWNER, ["j1"])
  })

  it("when the owner state cannot be read, the jobs still answer — without favorited / rating, never with a guess", async () => {
    // A missing field reads as "unknown"; a false one would make the next
    // favorite toggle REMOVE a favorite the read simply failed to see.
    seedList([listedJob("j1"), listedJob("j2")])
    vi.mocked(jobOwnerStateFor).mockRejectedValueOnce(new Error("gallery_favorites timeout"))
    const res = await list("")
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<Record<string, unknown>>
    expect(data.map((j) => j.id)).toEqual(["j1", "j2"])
    for (const job of data) {
      expect(job).not.toHaveProperty("favorited")
      expect(job).not.toHaveProperty("rating")
    }
  })

  it("GET /v1/jobs/:id answers the job when its owner state cannot be read — without the two fields", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), is: vi.fn(() => chain), single: vi.fn().mockResolvedValue({ data: listedJob(JOB), error: null }) }
      return chain as never
    })
    vi.mocked(jobOwnerStateFor).mockRejectedValueOnce(new Error("job_ratings timeout"))

    const res = await app.inject({ method: "GET", url: `/v1/jobs/${JOB}?__userId=${OWNER}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe(JOB)
    expect(res.json().data).not.toHaveProperty("favorited")
    expect(res.json().data).not.toHaveProperty("rating")
  })

  it("GET /v1/jobs/:id stamps the job with its owner's state", async () => {
    const row = { ...listedJob(JOB), user_id: OWNER }
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), is: vi.fn(() => chain), single: vi.fn().mockResolvedValue({ data: row, error: null }) }
      return chain as never
    })
    vi.mocked(jobOwnerStateFor).mockResolvedValueOnce(new Map([[JOB, { favorited: true, rating: "bad" as const }]]))

    const res = await app.inject({ method: "GET", url: `/v1/jobs/${JOB}?__userId=${OWNER}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ id: JOB, favorited: true, rating: "bad" })
    expect(jobOwnerStateFor).toHaveBeenCalledWith(OWNER, [JOB])
  })

  it("GET /v1/jobs/:id answers a never-marked job as not favorited, not rated", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), is: vi.fn(() => chain), single: vi.fn().mockResolvedValue({ data: listedJob(JOB), error: null }) }
      return chain as never
    })
    const res = await app.inject({ method: "GET", url: `/v1/jobs/${JOB}?__userId=${OWNER}` })
    expect(res.json().data).toMatchObject({ favorited: false, rating: null })
  })
})
