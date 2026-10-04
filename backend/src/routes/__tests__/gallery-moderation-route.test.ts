/**
 * GET /v1/gallery under the admin's moderation lists, the paging that must
 * survive them, and the bulk removal. Neutral stand-in words on purpose: the
 * real list is admin data, never code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

type Row = { id: string; completed_at: string } & Record<string, unknown>

const state = vi.hoisted(() => ({
  settings: { gallery_blocked_words: [] as unknown[], gallery_banned_users: [] as unknown[] },
  batches: [] as Row[][],
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => state.settings), settingsReadFailed: () => false }))

import { galleryRoutes } from "../gallery.js"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

/** One `.from(table)` chain: records its calls, answers like PostgREST when awaited. */
function chain(table: string) {
  const own: Array<{ table: string; method: string; args: unknown[] }> = []
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => {
            const counting = own.some((c) => c.method === "select" && (c.args[1] as { head?: boolean } | undefined)?.head)
            const updating = own.some((c) => c.method === "update")
            if (table === "jobs" && counting) return resolve({ count: 999, data: null, error: null })
            if (table === "jobs" && updating) {
              const ids = (own.find((c) => c.method === "in")?.args[1] ?? []) as string[]
              return resolve({ data: ids.map((id) => ({ id })), error: null })
            }
            if (table === "jobs") return resolve({ data: state.batches.shift() ?? [], error: null })
            return resolve({ data: null, error: null })
          }
        }
        return (...args: unknown[]) => {
          const call = { table, method: String(prop), args }
          own.push(call)
          state.calls.push(call)
          return proxy
        }
      },
    },
  )
  return proxy
}

let stamp = Date.parse("2026-10-01T00:00:00Z")
function row(userId: string, prompt: string): Row {
  stamp -= 1000
  const at = new Date(stamp).toISOString()
  return {
    id: `job-${stamp}`,
    job_type: "generate-image",
    input_data: { prompt },
    output_data: { imageUrl: `https://example.com/${stamp}.png` },
    completed_at: at,
    user_id: userId,
    provider: "kie",
  }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  state.settings = { gallery_blocked_words: [], gallery_banned_users: [] }
  state.batches = []
  state.calls = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => chain(table)) as never)
  vi.mocked(checkIsAdmin).mockResolvedValue(false)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const id = req.headers["x-user-id"]
    if (typeof id === "string" && id) req.userId = id
  })
  await app.register(async (instance) => {
    await galleryRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/gallery — the admin's moderation lists", () => {
  it("hides a blocked creator's work and a banned word's, from everyone but the creator", async () => {
    state.settings = {
      gallery_blocked_words: [{ word: "bucket", translations: ["seau"], exceptions: ["bucket of water"] }],
      gallery_banned_users: [{ userId: A, addedAt: null }],
    }
    const shown = row(B, "a sunset")
    const exception = row(B, "a bucket of water")
    state.batches = [[shown, row(A, "a sunset"), row(B, "a red bucket"), row(B, "un seau"), exception]]

    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=10" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((item: { id: string }) => item.id)).toEqual([shown.id, exception.id])
    const excluded = state.calls.filter((c) => c.table === "jobs" && c.method === "filter" && c.args[0] === "user_id")
    // Both the count and the page leave the blocked creator out in the query.
    expect(excluded.map((c) => c.args)).toEqual([
      ["user_id", "not.in", `(${A})`],
      ["user_id", "not.in", `(${A})`],
    ])
    // No owner id leaves the server.
    expect(JSON.stringify(res.json())).not.toContain(A)
  })

  it("the creator's own view keeps their work", async () => {
    state.settings = {
      gallery_blocked_words: [{ word: "bucket", translations: [], exceptions: [] }],
      gallery_banned_users: [{ userId: A, addedAt: null }],
    }
    const mine = [row(A, "a sunset"), row(A, "a red bucket")]
    state.batches = [mine]

    const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${A}&limit=10`, headers: { "x-user-id": A } })

    expect(res.json().data.map((item: { id: string }) => item.id)).toEqual(mine.map((r) => r.id))
    expect(state.calls.some((c) => c.method === "filter" && c.args[0] === "user_id")).toBe(false)
  })
})

describe("GET /v1/gallery — paging past hidden items", () => {
  beforeEach(() => {
    state.settings = { gallery_blocked_words: [{ word: "bucket", translations: [], exceptions: [] }], gallery_banned_users: [] }
  })

  it("a page with nothing to show still hands on a cursor while rows remain", async () => {
    // limit 2 reads 5 rows a round; every row is hidden, every round is full.
    state.batches = Array.from({ length: 12 }, () => Array.from({ length: 5 }, () => row(B, "bucket")))
    const lastRead = state.batches[9]![4]!

    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=2" })

    expect(res.json().data).toEqual([])
    expect(res.json().nextCursor).toBe(lastRead.completed_at)
  })

  it("after the rounds run out, the next page starts after the last row READ", async () => {
    const first = row(B, "a sunset")
    state.batches = [
      [first, ...Array.from({ length: 4 }, () => row(B, "bucket"))],
      ...Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => row(B, "bucket"))),
    ]
    // Rounds read 5 rows, then 3 (one item short of 2 → 1*2+1); five rounds in all.
    const lastRead = state.batches[4]![2]!

    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=2" })

    expect(res.json().data.map((item: { id: string }) => item.id)).toEqual([first.id])
    expect(res.json().nextCursor).toBe(lastRead.completed_at)
  })

  it("a page that fills up before its rows run out resumes after its last item — even in the last rows", async () => {
    // A short batch (4 of 5) is the end of the table, but two of its rows were never looked at.
    const rows = Array.from({ length: 4 }, () => row(B, "a sunset"))
    state.batches = [rows]

    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=2" })

    expect(res.json().data.map((item: { id: string }) => item.id)).toEqual([rows[0]!.id, rows[1]!.id])
    expect(res.json().nextCursor).toBe(rows[1]!.completed_at)
  })

  it("the end of the table ends the paging", async () => {
    state.batches = [[row(B, "a sunset")]]
    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=2" })
    expect(res.json().nextCursor).toBeNull()
  })

  it("a page that fills up on the last row of a full read resumes after that row", async () => {
    // limit 2 reads 5 rows; the 5th is the page's 2nd item, and the read was full.
    const shown = row(B, "a sunset")
    const rows = [...Array.from({ length: 3 }, () => row(B, "bucket")), row(B, "a pier"), shown]
    state.batches = [rows]

    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=2" })

    expect(res.json().data).toHaveLength(2)
    expect(res.json().nextCursor).toBe(shown.completed_at)
  })
})

describe("GET /v1/gallery — caching", () => {
  it("the public gallery may be cached by anyone", async () => {
    state.batches = [[row(B, "a sunset")]]
    const res = await app.inject({ method: "GET", url: "/v1/gallery?limit=10" })
    expect(res.headers["cache-control"]).toBe("public, max-age=30, stale-while-revalidate=86400")
    expect(res.headers.vary).toContain("Authorization")
  })

  it("a creator's own view is theirs alone — never stored", async () => {
    state.batches = [[row(A, "a sunset")]]
    const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${A}&limit=10`, headers: { "x-user-id": A } })
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })
})

describe("POST /v1/gallery/remove", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]

  it("needs a signed-in admin", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/gallery/remove", payload: { jobIds: ids } })).statusCode).toBe(401)
    const res = await app.inject({ method: "POST", url: "/v1/gallery/remove", payload: { jobIds: ids }, headers: { "x-user-id": B } })
    expect(res.statusCode).toBe(403)
    expect(state.calls.some((c) => c.method === "update")).toBe(false)
  })

  it("refuses an empty list, a non-id and more than 100 items", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const tooMany = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    for (const jobIds of [[], ["not-an-id"], tooMany]) {
      const res = await app.inject({ method: "POST", url: "/v1/gallery/remove", payload: { jobIds }, headers: { "x-user-id": ADMIN } })
      expect(res.statusCode).toBe(400)
    }
    expect(state.calls.some((c) => c.method === "update")).toBe(false)
  })

  it("takes the items out of the gallery and closes their reports", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const res = await app.inject({ method: "POST", url: "/v1/gallery/remove", payload: { jobIds: [...ids, ids[0]] }, headers: { "x-user-id": ADMIN } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, removed: 2 })
    const jobs = state.calls.filter((c) => c.table === "jobs")
    expect(jobs.find((c) => c.method === "update")?.args[0]).toEqual({ is_public: false })
    expect(jobs.find((c) => c.method === "in")?.args).toEqual(["id", ids])
    const reports = state.calls.filter((c) => c.table === "gallery_reports")
    expect(reports.find((c) => c.method === "update")?.args[0]).toEqual({ status: "reviewed" })
    expect(reports.find((c) => c.method === "in")?.args).toEqual(["job_id", ids])
    expect(reports.find((c) => c.method === "eq")?.args).toEqual(["status", "pending"])
  })

  it("the single delete does the same", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const res = await app.inject({ method: "DELETE", url: `/v1/gallery/${ids[0]}`, headers: { "x-user-id": ADMIN } })
    expect(res.statusCode).toBe(200)
    expect(state.calls.find((c) => c.table === "jobs" && c.method === "in")?.args).toEqual(["id", [ids[0]]])
    expect(state.calls.find((c) => c.table === "gallery_reports" && c.method === "in")?.args).toEqual(["job_id", [ids[0]]])
  })
})
