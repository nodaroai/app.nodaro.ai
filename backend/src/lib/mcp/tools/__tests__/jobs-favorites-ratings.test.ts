/**
 * MCP face of favorites, ratings and the jobs list filters:
 *   - `list_jobs` (scope mine) takes `status` (one or a list), `types`,
 *     `favorited` and `rating`, applied in the query through the SAME module
 *     `GET /v1/jobs` uses (lib/job-list-filters.ts), and stamps each job with
 *     the owner's `favorited` / `rating`.
 *   - `rate_job` rates one of the caller's jobs (assets:write, like REST).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../gallery-moderation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gallery-moderation.js")>()
  return { ...actual, loadGalleryModeration: async () => actual.OWNER_VIEW_MODERATION }
})
vi.mock("../../../job-owner-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../job-owner-state.js")>()
  return { ...actual, jobOwnerStateFor: vi.fn(async () => new Map()) }
})
vi.mock("../../../job-ratings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../job-ratings.js")>()
  return { ...actual, setJobRating: vi.fn() }
})

const { registerJobs } = await import("../jobs.js")
const { supabase } = await import("../../../supabase.js")
const { jobOwnerStateFor } = await import("../../../job-owner-state.js")
const { setJobRating } = await import("../../../job-ratings.js")

const JOB = "00000000-0000-4000-8000-0000000000d1"

const session = (scopes: Scope[]) => newSession({ userId: "u1", scopes, clientName: "Claude" })

async function server(scopes: Scope[]) {
  const s = buildServer()
  registerJobs({ server: s, session: session(scopes), fastify: Fastify() })
  return s
}

/** The jobs query: records every call, answers the rows. */
function seedList(rows: Array<Record<string, unknown>>, error: unknown = null) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(error ? { data: null, error } : { data: rows, error: null })
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

const job = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "completed",
  job_type: "generate-image",
  created_at: "2026-10-15T00:00:00Z",
  input_data: { type: "generate-image" },
  output_data: { imageUrl: `https://r2/${id}.png` },
  credits: 1,
  ...over,
})

const listed = async (args: Record<string, unknown>, scopes: Scope[] = ["jobs:read"]) => {
  const result = await callTool(await server(scopes), "list_jobs", args)
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(jobOwnerStateFor).mockResolvedValue(new Map())
})

describe("list_jobs — the shared filters (scope mine)", () => {
  it("a status list is one `in`; a single status string still works as before", async () => {
    const many = seedList([])
    await listed({ status: ["failed", "cancelled"] })
    expect(many).toContainEqual({ method: "in", args: ["status", ["failed", "cancelled"]] })

    const one = seedList([])
    await listed({ status: "failed" })
    expect(one).toContainEqual({ method: "eq", args: ["status", "failed"] })
  })

  it("types filter input_data.type, and lift the default image/video kinds — a text job is listed", async () => {
    const calls = seedList([job("t1", { job_type: "llm-structured", input_data: { type: "llm-structured" }, output_data: { json: {} } })])
    const result = await listed({ types: ["llm-structured"] })
    expect(calls).toContainEqual({ method: "filter", args: ["input_data->>type", "eq", "llm-structured"] })
    const { data } = JSON.parse(result.content[0]!.text as string) as { data: Array<{ id: string }> }
    expect(data.map((r) => r.id)).toEqual(["t1"])
  })

  it("favorited and rating embed the owner's rows by their foreign keys and filter on them", async () => {
    const calls = seedList([])
    await listed({ favorited: true, rating: "unrated" })
    const select = String(calls.find((c) => c.method === "select")?.args[0])
    expect(select).toContain("gallery_favorites!gallery_favorites_job_id_fkey!inner(job_id)")
    expect(select).toContain("job_ratings!job_ratings_job_id_fkey(rating)")
    expect(calls).toContainEqual({ method: "eq", args: ["gallery_favorites.user_id", "u1"] })
    expect(calls).toContainEqual({ method: "eq", args: ["job_ratings.user_id", "u1"] })
    expect(calls).toContainEqual({ method: "is", args: ["job_ratings", null] })
  })

  it("each of your jobs carries favorited and rating, from one owner-state read; the embeds never show", async () => {
    seedList([job("j1", { gallery_favorites: [{ job_id: "j1" }] }), job("j2", { gallery_favorites: [{ job_id: "j2" }] })])
    vi.mocked(jobOwnerStateFor).mockResolvedValueOnce(new Map([["j1", { favorited: true, rating: "good" as const }]]))

    const result = await listed({ favorited: true })

    const text = result.content[0]!.text as string
    expect(text).not.toContain("gallery_favorites")
    const { data } = JSON.parse(text) as { data: Array<{ id: string; favorited: boolean; rating: string | null }> }
    expect(data.map((r) => [r.id, r.favorited, r.rating])).toEqual([
      ["j1", true, "good"],
      ["j2", false, null],
    ])
    expect(jobOwnerStateFor).toHaveBeenCalledTimes(1)
    expect(jobOwnerStateFor).toHaveBeenCalledWith("u1", ["j1", "j2"])
  })

  it("a rating filter before ratings reach this database says so instead of a raw error", async () => {
    seedList([], { code: "PGRST200", message: "Could not find a relationship between 'jobs' and 'job_ratings'" })
    const result = await listed({ rating: "good" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/not available/i)
    expect(result.content[0]!.text).not.toContain("relationship")
  })

  it("a broken favorites embed beside a rating filter is reported as the error it is, never 'ratings not available'", async () => {
    seedList([], {
      code: "PGRST200",
      message: "Could not find a relationship between 'jobs' and 'gallery_favorites' in the schema cache",
      hint: "Perhaps you meant 'job_ratings' instead of 'gallery_favorites'.",
    })
    const result = await listed({ favorited: true, rating: "good" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).not.toMatch(/not available/i)
    expect(result.content[0]!.text).toMatch(/^Error:/)
  })

  it("pages off the RAW page: a page the kinds filter thinned still carries the next cursor", async () => {
    // limit 2, both rows came back (a full page), but the default kinds
    // (image, video) drop the text job. Paging off the thinned page would end
    // the listing here with older jobs still unread.
    seedList([
      job("img", { created_at: "2026-10-15T00:00:02Z" }),
      job("txt", { job_type: "llm-structured", input_data: { type: "llm-structured" }, output_data: { json: {} }, created_at: "2026-10-15T00:00:01Z" }),
    ])
    const result = await listed({ limit: 2, favorited: true })
    const body = JSON.parse(result.content[0]!.text as string) as { data: Array<{ id: string }>; next_cursor: string | null }
    expect(body.data.map((r) => r.id)).toEqual(["img"])
    expect(body.next_cursor).toBe("2026-10-15T00:00:01Z")
  })

  it("a page shorter than the limit has no next cursor, as before", async () => {
    seedList([job("img", { created_at: "2026-10-15T00:00:02Z" })])
    const result = await listed({ limit: 2 })
    expect((JSON.parse(result.content[0]!.text as string) as { next_cursor: string | null }).next_cursor).toBeNull()
  })

  it("when favorites and ratings cannot be read, the jobs still list — without the two fields, never with a guess", async () => {
    seedList([job("j1")])
    vi.mocked(jobOwnerStateFor).mockRejectedValueOnce(new Error("gallery_favorites timeout"))
    const result = await listed({})
    expect(result.isError).toBeUndefined()
    const { data } = JSON.parse(result.content[0]!.text as string) as { data: Array<Record<string, unknown>> }
    expect(data.map((r) => r.id)).toEqual(["j1"])
    expect(data[0]).not.toHaveProperty("favorited")
    expect(data[0]).not.toHaveProperty("rating")
  })
})

describe("list_jobs — scope public stays the gallery", () => {
  it("refuses the owner-only filters, which have nothing to say about other people's jobs", async () => {
    for (const args of [{ favorited: true }, { rating: "good" }, { types: ["generate-image"] }]) {
      seedList([])
      const result = await listed({ scope: "public", ...args })
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toMatch(/scope.*mine/i)
    }
  })

  it("stamps no favorited or rating on someone else's job", async () => {
    seedList([job("p1", { user_id: "someone-else" })])
    const result = await listed({ scope: "public" })
    const { data } = JSON.parse(result.content[0]!.text as string) as { data: Array<Record<string, unknown>> }
    expect(data[0]).not.toHaveProperty("rating")
    expect(data[0]).not.toHaveProperty("favorited")
    expect(jobOwnerStateFor).not.toHaveBeenCalled()
  })
})

describe("rate_job", () => {
  it("is registered with assets:write only — not jobs:read, not assets:read", async () => {
    const names = async (scopes: Scope[]) => (await listTools(await server(scopes))).map((t) => t.name)
    expect(await names(["assets:write"])).toContain("rate_job")
    expect(await names(["jobs:read"])).not.toContain("rate_job")
    expect(await names(["assets:read"])).not.toContain("rate_job")
    // …and assets:write alone registers no read tool.
    expect(await names(["assets:write"])).not.toContain("list_jobs")
  })

  it("rates one of your jobs, and null clears the rating", async () => {
    const s = await server(["assets:write"])
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "ok", rating: "good" })
    const rated = await callTool(s, "rate_job", { job_id: JOB, rating: "good" })
    expect(rated.isError).toBeUndefined()
    expect(JSON.parse(rated.content[0]!.text as string)).toEqual({ data: { jobId: JOB, rating: "good" } })
    expect(setJobRating).toHaveBeenLastCalledWith("u1", JOB, "good")

    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "ok", rating: null })
    const cleared = await callTool(s, "rate_job", { job_id: JOB, rating: null })
    expect(JSON.parse(cleared.content[0]!.text as string)).toEqual({ data: { jobId: JOB, rating: null } })
    expect(setJobRating).toHaveBeenLastCalledWith("u1", JOB, null)
  })

  it("a job that is not yours — or an id that is not a job — is not found", async () => {
    const s = await server(["assets:write"])
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "not_found" })
    const theirs = await callTool(s, "rate_job", { job_id: JOB, rating: "bad" })
    expect(theirs.isError).toBe(true)
    expect(theirs.content[0]!.text).toMatch(/not found/i)

    const notAnId = await callTool(s, "rate_job", { job_id: "task-123", rating: "bad" })
    expect(notAnId.isError).toBe(true)
    expect(setJobRating).toHaveBeenCalledTimes(1)
  })

  it("says so while ratings are not available on this server", async () => {
    vi.mocked(setJobRating).mockResolvedValueOnce({ kind: "not_available" })
    const result = await callTool(await server(["assets:write"]), "rate_job", { job_id: JOB, rating: "good" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/not available/i)
  })

  it("refuses a rating outside good | bad | null", async () => {
    const result = await callTool(await server(["assets:write"]), "rate_job", { job_id: JOB, rating: "meh" })
    expect(result.isError).toBe(true)
    expect(setJobRating).not.toHaveBeenCalled()
  })
})
