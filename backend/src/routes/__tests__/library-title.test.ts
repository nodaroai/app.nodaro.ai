/**
 * `GET /v1/library` carries the name the owner gave the job that made each
 * file (`title`, migration 609): a to-one embed on `assets.job_id`, read in
 * the same query — never a second lookup, never a copy on the asset row (its
 * `filename` is the download name and keeps its own meaning).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const db = vi.hoisted(() => ({
  table: "",
  selects: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          // The listing's own query (the one that embeds the job) answers the rows; every other read is empty.
          const last = db.selects[db.selects.length - 1] ?? ""
          const rows = db.table === "assets" && last.includes("job:jobs!job_id(title)") ? db.rows : []
          resolve({ data: rows, error: null, count: rows.length })
        }
      }
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null })
      return (...args: unknown[]) => {
        if (prop === "select") db.selects.push(String(args[0]))
        return proxy
      }
    },
  })
  return { supabase: { from: (table: string) => { db.table = table; return proxy } } }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

const { libraryRoutes, embeddedJobTitle } = await import("../library.js")

const USER = "11111111-1111-4111-8111-111111111111"

function asset(id: string, over: Record<string, unknown>) {
  return {
    id,
    user_id: USER,
    type: "image",
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 10,
    r2_key: `k/${id}`,
    r2_url: `https://pub-test.r2.dev/k/${id}`,
    metadata: {},
    is_library_item: false,
    upload_source: "generated",
    source: "web",
    source_detail: null,
    created_at: "2026-11-09T00:00:00+00:00",
    job_id: null,
    ...over,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  db.selects = []
  db.rows = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

describe("GET /v1/library — the job's name on each file", () => {
  it("reads the name in the listing's own query and answers it as `title`; a file with no job, or an unnamed one, has null", async () => {
    db.rows = [
      asset("a1", { job_id: "j1", job: { title: "Hero shot v2" } }),
      asset("a2", { job_id: "j2", job: { title: null } }),
      asset("a3", { job_id: null, job: null }),
      // A to-one embed arrives as an object; a one-element array is accepted too.
      asset("a4", { job_id: "j4", job: [{ title: "In an array" }] }),
    ]
    const res = await app.inject({ method: "GET", url: "/v1/library?owned=true" })
    expect(res.statusCode).toBe(200)
    const data = (res.json() as { data: Array<{ id: string; title: string | null; filename: string }> }).data
    expect(data.map((a) => [a.id, a.title])).toEqual([
      ["a1", "Hero shot v2"],
      ["a2", null],
      ["a3", null],
      ["a4", "In an array"],
    ])
    // The download name is untouched by the job's name.
    expect(data[0].filename).toBe("a1.png")
    expect(db.selects.some((s) => s.includes("job:jobs!job_id(title)"))).toBe(true)
  })
})

describe("embeddedJobTitle", () => {
  it("reads an object or a one-element array, and treats a missing, empty or non-string name as none", () => {
    expect(embeddedJobTitle({ title: "x" })).toBe("x")
    expect(embeddedJobTitle([{ title: "y" }])).toBe("y")
    expect(embeddedJobTitle({ title: null })).toBeNull()
    expect(embeddedJobTitle({ title: "" })).toBeNull()
    expect(embeddedJobTitle({ title: 7 })).toBeNull()
    expect(embeddedJobTitle(null)).toBeNull()
    expect(embeddedJobTitle(undefined)).toBeNull()
    expect(embeddedJobTitle([])).toBeNull()
  })
})
