import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify"

/**
 * A failed job's provider words on the job reads (lib/provider-words.ts).
 *
 * A deployment can keep what the provider itself said about a failure
 * (`jobs.error_detail`) for its admins: `jobs.errorDetail: "admin"` on its
 * surface profile. Then a reader who is not an admin reads a failed job on
 * every job route exactly as one the provider said nothing about: the same
 * keys, `error_detail` null. An admin still reads the words. Without the
 * setting (or with a profile that leaves `jobs` out) every read answers as
 * before.
 *
 * The fake `jobs` table PROJECTS to the columns the route selected, aliases
 * included (`alias:column->key` and `->>key`), as PostgREST would: a lean read
 * answers only what it asked for, and the trend-run marker reaches the mask.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
// The owner's favorite/rating reads have their own tests (jobs-favorites-ratings).
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))

import { jobRoutes } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { TREND_RUN_FAILURE_MESSAGE } from "../../lib/public-job-data.js"

type Row = Record<string, unknown>
type Role = "user" | "admin" | "super_admin"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORDS = "task failed: [400] Request blocked: the uploaded image may contain restricted content."

const FAILED: Row = {
  id: "job-failed",
  user_id: OWNER,
  status: "failed",
  progress: 0,
  job_type: "generate-image",
  input_data: { type: "generate-image", prompt: "a lighthouse" },
  output_data: null,
  error_message: "The image model declined one of your pictures. Try a different picture.",
  error_detail: WORDS,
  error_hint: null,
  created_at: "2026-11-01T10:00:00Z",
  started_at: "2026-11-01T10:00:01Z",
  completed_at: "2026-11-01T10:00:09Z",
  credits: 40,
  provider: "kie",
  provider_cost: 0.04,
  display_cost: 0.05,
  credits_actual: null,
  reconcile_attempts: 0,
  source: "web",
  source_detail: null,
  session_id: null,
  usage_log_id: null,
  workflow_execution_id: null,
}
/** The same failure with no provider text. */
const NO_WORDS: Row = { ...FAILED, error_detail: null }
/** A trend run: its failure text can quote its hidden input. */
const TREND_RUN: Row = {
  ...FAILED,
  id: "job-trend",
  input_data: { type: "generate-video", trend: { slug: "slow-zoom" } },
  error_message: "Could not read the source clip of role 'hero'.",
}

const ADMIN_ONLY_WORDS = { jobs: { errorDetail: "admin" } }

/** Sets the deployment's surface profile (undefined = none), then drops the memoized read. */
function setProfile(profile: unknown): void {
  if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function project(row: Row, select: string): Row {
  const out: Row = {}
  for (const raw of select.split(",").map((c) => c.trim()).filter(Boolean)) {
    const alias = /^(\w+):(\w+)->>?(\w+)$/.exec(raw)
    if (alias) {
      const src = row[alias[2]!]
      const v = src && typeof src === "object" ? (src as Row)[alias[3]!] : undefined
      out[alias[1]!] = v === undefined ? null : v
    } else if (raw in row) {
      out[raw] = row[raw]
    }
  }
  return out
}

/** The `jobs` table holds exactly `row`; `usage_logs` holds nothing. */
function seed(row: Row): void {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "usage_logs") {
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) } as never
    }
    if (table !== "jobs") throw new Error(`unexpected table ${table}`)
    let select = ""
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res({ data: [project(row, select)], error: null })
        if (prop === "single") return () => Promise.resolve({ data: project(row, select), error: null })
        if (prop === "select") return (s: string) => { select = s; return proxy }
        return () => proxy
      },
    })
    return proxy as never
  })
}

let app: FastifyInstance

/** Each job read: how to ask it for one job, and where its answer holds that job. */
interface Surface {
  name: string
  ask: (id: string, headers: Record<string, string>) => Promise<LightMyRequestResponse>
  pick: (body: { data?: unknown; jobs?: unknown }) => unknown
}
const SURFACES: Surface[] = [
  {
    name: "GET /v1/jobs/:id",
    ask: (id, headers) => app.inject({ method: "GET", url: `/v1/jobs/${id}`, headers }),
    pick: (body) => body.data,
  },
  {
    name: "GET /v1/jobs/:id/status",
    ask: (id, headers) => app.inject({ method: "GET", url: `/v1/jobs/${id}/status`, headers }),
    pick: (body) => body.data,
  },
  {
    name: "GET /v1/jobs/status?ids= (batch poll)",
    ask: (id, headers) => app.inject({ method: "GET", url: `/v1/jobs/status?ids=${id}`, headers }),
    pick: (body) => (body.jobs as unknown[])[0],
  },
  {
    name: "POST /v1/jobs/batch-status",
    ask: (id, headers) => app.inject({ method: "POST", url: "/v1/jobs/batch-status", headers, payload: { jobIds: [id] } }),
    pick: (body) => (body.data as unknown[])[0],
  },
  {
    name: "GET /v1/jobs (list)",
    ask: (_id, headers) => app.inject({ method: "GET", url: "/v1/jobs", headers }),
    pick: (body) => (body.data as unknown[])[0],
  },
]

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(async () => {
  vi.clearAllMocks()
  // The surface profile is honoured on Business and Cloud; Business also keeps
  // the run-credit reads (steps, side holds) from reading anything.
  config.EDITION = "business"
  setProfile(undefined)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-test-user"]
    if (typeof user !== "string") return
    req.userId = user
    const role = req.headers["x-test-role"]
    req.userRole = role === "admin" || role === "super_admin" ? role : undefined
  })
  await app.register(async (i) => { await jobRoutes(i) })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

describe.each(SURFACES)("$name", (surface) => {
  /** The job as `role` reads it, the jobs table holding only `row`. */
  async function read(row: Row, role: Role): Promise<Row> {
    seed(row)
    const res = await surface.ask(String(row.id), { "x-test-user": OWNER, "x-test-role": role })
    expect(res.statusCode).toBe(200)
    const job = surface.pick(res.json()) as Row | undefined
    expect(job).toBeDefined()
    return job!
  }

  it("without the setting, the owner reads the provider's words, and a profile that leaves `jobs` out (or says owner) changes nothing", async () => {
    const shown = await read(FAILED, "user")
    expect(shown.error_detail).toBe(WORDS)
    setProfile({ brand: { productName: "Acme" } })
    expect(await read(FAILED, "user")).toStrictEqual(shown)
    setProfile({ jobs: { errorDetail: "owner" } })
    expect(await read(FAILED, "user")).toStrictEqual(shown)
  })

  it("with the words kept for admins, the owner reads the failure as one with no words: error_detail null, every other key as before", async () => {
    const shown = await read(FAILED, "user")
    setProfile(ADMIN_ONLY_WORDS)
    const withheld = await read(FAILED, "user")
    expect(withheld).toHaveProperty("error_detail", null)
    expect(withheld).toStrictEqual({ ...shown, error_detail: null })
    // Exactly what a failed job the provider said nothing about answers.
    expect(withheld).toStrictEqual(await read(NO_WORDS, "user"))
    expect(JSON.stringify(withheld)).not.toContain("Request blocked")
  })

  it("with the words kept for admins, an admin or super_admin reader still reads them, exactly as before", async () => {
    const before = { admin: await read(FAILED, "admin"), super_admin: await read(FAILED, "super_admin") }
    setProfile(ADMIN_ONLY_WORDS)
    for (const role of ["admin", "super_admin"] as const) {
      const after = await read(FAILED, role)
      expect(after.error_detail).toBe(WORDS)
      expect(after).toStrictEqual(before[role])
    }
  })

  it("a failed job with no words reads the same under both settings", async () => {
    const off = await read(NO_WORDS, "user")
    expect(off).toHaveProperty("error_detail", null)
    setProfile(ADMIN_ONLY_WORDS)
    expect(await read(NO_WORDS, "user")).toStrictEqual(off)
  })

  it("a trend run still reads as before under both settings: masked for the owner, the real text for an admin", async () => {
    for (const profile of [undefined, ADMIN_ONLY_WORDS]) {
      setProfile(profile)
      const owner = await read(TREND_RUN, "user")
      expect(owner).toMatchObject({ error_message: TREND_RUN_FAILURE_MESSAGE, error_detail: null })
      expect(owner).not.toHaveProperty("trend_run_marker")
      const admin = await read(TREND_RUN, "admin")
      expect(admin).toMatchObject({ error_message: TREND_RUN.error_message, error_detail: WORDS })
      expect(admin).not.toHaveProperty("trend_run_marker")
    }
  })
})
