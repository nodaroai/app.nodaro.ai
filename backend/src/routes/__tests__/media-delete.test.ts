import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const R2_PUBLIC_URL = "https://pub-test.r2.dev"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  // Mirror of the real implementation (lib/storage.ts) against the test prefix.
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://pub-test.r2.dev/") ? url.slice("https://pub-test.r2.dev/".length) : null,
  s3: {},
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { mediaDeleteRoutes } from "../media-delete.js"
import { supabase } from "../../lib/supabase.js"
import { deleteFromR2 } from "../../lib/storage.js"
import { updateStorageUsage } from "../../utils/file-validation.js"

// ---------------------------------------------------------------------------
// Supabase chain mock — records every builder call; a scenario function maps
// (table, recorded calls, terminal) → the resolved value. Chains resolve either
// at `.maybeSingle()`/`.single()` or when awaited directly (`then`).
// ---------------------------------------------------------------------------

type Recorded = { method: string; args: unknown[] }
type Scenario = (table: string, calls: Recorded[], terminal: string) => unknown

function makeChain(table: string, scenario: Scenario) {
  const calls: Recorded[] = []
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      const method = String(prop)
      if (method === "then") {
        return (resolve: (v: unknown) => void) => resolve(scenario(table, calls, "await"))
      }
      if (method === "maybeSingle" || method === "single") {
        return (...args: unknown[]) => {
          calls.push({ method, args })
          return Promise.resolve(scenario(table, calls, method))
        }
      }
      return (...args: unknown[]) => {
        calls.push({ method, args })
        return proxy
      }
    },
  }
  const proxy: Record<string, unknown> = new Proxy({}, handler)
  return proxy
}

function useScenario(scenario: Scenario) {
  vi.mocked(supabase.from).mockImplementation(
    (table: string) => makeChain(table, scenario) as never,
  )
}

const eqVal = (calls: Recorded[], col: string) =>
  calls.find((c) => c.method === "eq" && c.args[0] === col)?.args[1]
const has = (calls: Recorded[], method: string) => calls.some((c) => c.method === method)
const eqOutputKey = (calls: Recorded[]) =>
  calls.find((c) => c.method === "eq" && String(c.args[0]).startsWith("output_data->>"))

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

const OWNED_URL = `${R2_PUBLIC_URL}/uploads/audios/owned.mp3`
const OWNED_KEY = "uploads/audios/owned.mp3"
const JOB_URL = `${R2_PUBLIC_URL}/audios/job-output.mp3`
const JOB_KEY = "audios/job-output.mp3"
const STEM_URL = `${R2_PUBLIC_URL}/audio/vcp-stem-recast-0-A.mp3`
const UNOWNED_URL = `${R2_PUBLIC_URL}/images/someone-elses.png`
const FOREIGN_URL = "https://cdn.example.com/not-ours.mp3"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(deleteFromR2).mockResolvedValue(undefined)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from query for protected routes
  app.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, unknown> | undefined
    const userId = query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
    }
  })

  await app.register(async (instance) => {
    await mediaDeleteRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function inject(body: unknown, authed = true) {
  return app.inject({
    method: "POST",
    url: authed ? `/v1/media/delete?userId=${TEST_USER_ID}` : "/v1/media/delete",
    payload: body as Record<string, unknown>,
  })
}

// ---------------------------------------------------------------------------
// Auth + validation
// ---------------------------------------------------------------------------

describe("POST /v1/media/delete — auth + validation", () => {
  it("returns 401 when no auth", async () => {
    const res = await inject({ urls: [OWNED_URL] }, false)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it("rejects an empty urls array", async () => {
    const res = await inject({ urls: [] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects more than 50 urls", async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `${R2_PUBLIC_URL}/images/${i}.png`)
    const res = await inject({ urls })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it("accepts exactly 50 urls", async () => {
    useScenario(() => ({ data: null, error: null, count: 0 }))
    const urls = Array.from({ length: 50 }, (_, i) => `${R2_PUBLIC_URL}/images/${i}.png`)
    const res = await inject({ urls })
    expect(res.statusCode).toBe(200)
  })

  it("rejects non-URL strings", async () => {
    const res = await inject({ urls: ["not a url"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// Skip paths
// ---------------------------------------------------------------------------

describe("POST /v1/media/delete — skips", () => {
  it("skips foreign URLs without touching the DB (reason: foreign)", async () => {
    const res = await inject({ urls: [FOREIGN_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      deleted: [],
      skipped: [{ url: FOREIGN_URL, reason: "foreign" }],
    })
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  it("skips our-bucket URLs with neither ownership proof (reason: not-owned)", async () => {
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        // Ownership lookup MUST be caller-scoped.
        expect(eqVal(calls, "user_id")).toBe(TEST_USER_ID)
        return { data: null, error: null }
      }
      if (table === "jobs") {
        expect(eqVal(calls, "user_id")).toBe(TEST_USER_ID)
        return { count: 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [UNOWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      deleted: [],
      skipped: [{ url: UNOWNED_URL, reason: "not-owned" }],
    })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Path (a) — assets-row ownership
// ---------------------------------------------------------------------------

describe("POST /v1/media/delete — assets path", () => {
  it("deletes R2 object + row + decrements storage, and never lets the caller's own job block it", async () => {
    let rowDeletes = 0
    let jobsQueried = 0

    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        expect(eqVal(calls, "r2_key")).toBe(OWNED_KEY)
        expect(eqVal(calls, "user_id")).toBe(TEST_USER_ID)
        return { data: { id: "asset-1", r2_key: OWNED_KEY, size_bytes: 4096 }, error: null }
      }
      if (table === "assets" && has(calls, "delete")) {
        rowDeletes++
        // Row delete is tenant-scoped and RETURNING (double-decrement guard).
        expect(eqVal(calls, "id")).toBe("asset-1")
        expect(eqVal(calls, "user_id")).toBe(TEST_USER_ID)
        return { data: [{ id: "asset-1" }], error: null }
      }
      if (table === "assets" && has(calls, "neq")) {
        // Cross-user referrer count inside the shared core: no other rows.
        return { count: 0, error: null }
      }
      if (table === "jobs") {
        jobsQueried++
        return { count: 5, error: null } // even 5 referencing jobs must NOT block
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [OWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: [OWNED_URL], skipped: [] })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(OWNED_KEY)
    expect(rowDeletes).toBe(1)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(TEST_USER_ID, -4096)
    // The whole point of url-targeted deletion: the caller's own job output
    // referencing this url is their deliberate dangling choice, so the jobs
    // referrer check must not even run (unlike DELETE /v1/library/:id).
    expect(jobsQueried).toBe(0)
  })

  it("keeps the R2 object when ANOTHER assets row references it, but still deletes the row + decrements (reported deleted)", async () => {
    let rowDeletes = 0

    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: { id: "asset-1", r2_key: OWNED_KEY, size_bytes: 100 }, error: null }
      }
      if (table === "assets" && has(calls, "delete")) {
        rowDeletes++
        return { data: [{ id: "asset-1" }], error: null }
      }
      if (table === "assets" && has(calls, "neq")) {
        return { count: 1, error: null } // another user's gallery save
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [OWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: [OWNED_URL], skipped: [] })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(rowDeletes).toBe(1)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(TEST_USER_ID, -100)
  })

  it("skips with reason error when the row delete fails (quota charge must survive with the row)", async () => {
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: { id: "asset-1", r2_key: OWNED_KEY, size_bytes: 100 }, error: null }
      }
      if (table === "assets" && has(calls, "delete")) {
        return { data: null, error: { message: "db down" } }
      }
      if (table === "assets" && has(calls, "neq")) {
        return { count: 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [OWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      deleted: [],
      skipped: [{ url: OWNED_URL, reason: "error" }],
    })
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Path (b) — job-output ownership (no assets row)
// ---------------------------------------------------------------------------

describe("POST /v1/media/delete — job-output path", () => {
  it("deletes ONLY the R2 object for a caller-owned job output: no row delete, no storage decrement", async () => {
    let assetDeletes = 0
    let bareAssetRefChecks = 0

    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: null, error: null } // no assets row anywhere for the caller
      }
      if (table === "assets" && has(calls, "delete")) {
        assetDeletes++
        return { data: [], error: null }
      }
      if (table === "assets") {
        // Path (b) referrer safety: bare r2_key count across ALL users.
        bareAssetRefChecks++
        expect(eqVal(calls, "r2_key")).toBe(JOB_KEY)
        expect(eqVal(calls, "user_id")).toBeUndefined()
        return { count: 0, error: null }
      }
      if (table === "jobs") {
        expect(eqVal(calls, "user_id")).toBe(TEST_USER_ID)
        const keyEq = eqOutputKey(calls)
        if (keyEq && keyEq.args[0] === "output_data->>audioUrl" && keyEq.args[1] === JOB_URL) {
          return { count: 1, error: null } // the caller's export job
        }
        return { count: 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [JOB_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: [JOB_URL], skipped: [] })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(JOB_KEY)
    expect(assetDeletes).toBe(0)
    expect(bareAssetRefChecks).toBe(1)
    // Job outputs' accounting unit is the assets row; with no row there is
    // nothing to decrement.
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
  })

  it("proves ownership of row-less voice-changer-pro stems via voiceStems jsonb containment", async () => {
    let containsSeen: unknown

    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: null, error: null }
      }
      if (table === "assets") {
        return { count: 0, error: null }
      }
      if (table === "jobs") {
        const contains = calls.find((c) => c.method === "contains")
        if (contains) {
          containsSeen = contains.args
          return { count: 1, error: null }
        }
        return { count: 0, error: null } // none of the flat url keys match
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [STEM_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: [STEM_URL], skipped: [] })
    expect(containsSeen).toEqual(["output_data", { voiceStems: [{ url: STEM_URL }] }])
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith("audio/vcp-stem-recast-0-A.mp3")
  })

  it("skips (in-use) when the job output's object is still referenced by ANY assets row", async () => {
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: null, error: null }
      }
      if (table === "assets") {
        return { count: 1, error: null } // e.g. another user saved it from the gallery
      }
      if (table === "jobs") {
        const keyEq = eqOutputKey(calls)
        return { count: keyEq?.args[0] === "output_data->>audioUrl" ? 1 : 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [JOB_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      deleted: [],
      skipped: [{ url: JOB_URL, reason: "in-use" }],
    })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  it("skips (error) when the R2 delete itself fails", async () => {
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") return { data: null, error: null }
      if (table === "assets") return { count: 0, error: null }
      if (table === "jobs") {
        const keyEq = eqOutputKey(calls)
        return { count: keyEq?.args[0] === "output_data->>audioUrl" ? 1 : 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })
    vi.mocked(deleteFromR2).mockRejectedValue(new Error("r2 down"))

    const res = await inject({ urls: [JOB_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      deleted: [],
      skipped: [{ url: JOB_URL, reason: "error" }],
    })
  })
})

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

describe("POST /v1/media/delete — batches", () => {
  function mixedScenario(): Scenario {
    return (table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        return eqVal(calls, "r2_key") === OWNED_KEY
          ? { data: { id: "asset-1", r2_key: OWNED_KEY, size_bytes: 64 }, error: null }
          : { data: null, error: null }
      }
      if (table === "assets" && has(calls, "delete")) {
        return { data: [{ id: "asset-1" }], error: null }
      }
      if (table === "assets") {
        return { count: 0, error: null } // no referrers anywhere
      }
      if (table === "jobs") {
        const keyEq = eqOutputKey(calls)
        const proven =
          keyEq?.args[0] === "output_data->>audioUrl" && keyEq?.args[1] === JOB_URL
        return { count: proven ? 1 : 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    }
  }

  it("handles a mixed batch: 200 with each url in exactly one bucket", async () => {
    useScenario(mixedScenario())

    const res = await inject({ urls: [FOREIGN_URL, OWNED_URL, JOB_URL, UNOWNED_URL] })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.deleted).toEqual([OWNED_URL, JOB_URL])
    expect(body.skipped).toEqual([
      { url: FOREIGN_URL, reason: "foreign" },
      { url: UNOWNED_URL, reason: "not-owned" },
    ])
  })

  it("returns 200 even when every url is skipped (idempotent housekeeping)", async () => {
    useScenario(mixedScenario())

    const res = await inject({ urls: [FOREIGN_URL, UNOWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json().deleted).toEqual([])
    expect(res.json().skipped).toHaveLength(2)
  })

  it("processes duplicate urls once — the first pass's referrer-kept object must not fall to a second pass", async () => {
    let ownershipLookups = 0
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") {
        ownershipLookups++
        return { data: { id: "asset-1", r2_key: OWNED_KEY, size_bytes: 64 }, error: null }
      }
      if (table === "assets" && has(calls, "delete")) {
        return { data: [{ id: "asset-1" }], error: null }
      }
      if (table === "assets") return { count: 0, error: null }
      if (table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const res = await inject({ urls: [OWNED_URL, OWNED_URL] })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: [OWNED_URL], skipped: [] })
    expect(ownershipLookups).toBe(1)
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledTimes(1)
  })
})
