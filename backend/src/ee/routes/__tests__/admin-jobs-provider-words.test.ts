/**
 * The admin job reads keep a failed job's provider words on a deployment that
 * keeps them for its admins (`jobs.errorDetail: "admin"`, lib/provider-words.ts):
 * the one-job read and the child-jobs read answer an admin, behind requireAdmin,
 * exactly as they do without the setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const OWNER_UUID = "00000000-0000-4000-8000-000000000001"
const JOB_ID = "00000000-0000-4000-8000-0000000000a1"
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => false,
}))

vi.mock("@/lib/llm-metered-schema-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/llm-metered-schema-gate.js")>()),
  llmMeteredSchemaReady: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
    if (req.userId !== ADMIN_UUID) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests, surfaceJobErrorDetailReaders } from "../../../lib/surface-profile.js"
import { adminJobsRoutes } from "../admin-jobs.js"

/** A `jobs` table answering the filters a query asks for: by id, by owner, by parent. */
function jobsTable(rows: Array<Record<string, unknown>>): void {
  mockFrom.mockImplementation((table: string) => {
    const q = { eq: [] as Array<[string, unknown]>, in: null as [string, unknown[]] | null, single: false, head: false }
    const chain: Record<string, unknown> = {}
    chain.select = (_columns: string, opts?: { head?: boolean }) => ((q.head = !!opts?.head), chain)
    chain.order = () => chain
    chain.eq = (c: string, v: unknown) => (q.eq.push([c, v]), chain)
    chain.in = (c: string, v: unknown[]) => ((q.in = [c, v]), chain)
    chain.is = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => ((q.single = true), chain)
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (table !== "jobs") return resolve({ data: [], error: null })
      const found = rows.filter((r) => q.eq.every(([c, v]) => r[c] === v) && (!q.in || q.in[1].includes(r[q.in[0]])))
      if (q.head) return resolve({ count: found.length, error: null })
      return resolve({ data: q.single ? found[0] ?? null : found, error: null })
    }
    return chain
  })
}

const ROWS = [
  { id: JOB_ID, user_id: OWNER_UUID, parent_job_id: null, created_at: "2026-11-11T10:00:00.000Z", status: "failed", error_message: "The model declined one of your pictures.", error_detail: WORDS, credits: 30, usage_log_id: null },
  { id: "child", user_id: OWNER_UUID, parent_job_id: JOB_ID, created_at: "2026-11-11T10:00:01.000Z", status: "failed", error_message: "declined", error_detail: WORDS, usage_log_id: null },
]

let app: FastifyInstance
const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(async () => {
  vi.clearAllMocks()
  mockRpc.mockResolvedValue({ data: [], error: null })
  config.EDITION = "business"
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminJobsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

const adminGet = (url: string) => app.inject({ method: "GET", url, headers: { "x-user-id": ADMIN_UUID } })

describe("the admin job reads, on a deployment that keeps the provider's words for its admins", () => {
  it("the setting is in force", () => {
    expect(surfaceJobErrorDetailReaders()).toBe("admin")
  })

  it("the one-job read returns the words", async () => {
    jobsTable(ROWS)
    const res = await adminGet(`/v1/admin/jobs/${JOB_ID}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.error_detail).toBe(WORDS)
  })

  it("the child-jobs read returns each step's words", async () => {
    jobsTable(ROWS)
    const res = await adminGet(`/v1/admin/jobs/${JOB_ID}/children`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((r: { id: string; error_detail: string | null }) => [r.id, r.error_detail])).toEqual([["child", WORDS]])
  })
})
