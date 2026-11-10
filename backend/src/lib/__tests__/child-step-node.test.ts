/**
 * A step a plugin engine's job sends is gated as the node the user ran — its
 * parent job's (lib/child-step-node.ts, decided 2026-11-10) — and nothing else
 * is: a request without a parent job attached by server code, another user's
 * job, a finished job, a job no node accounts for, or a deployment that does
 * not list its nodes keeps the route's own node.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import type { FastifyRequest } from "fastify"

const db = vi.hoisted(() => ({
  rows: new Map<string, { user_id: string; job_type?: string | null; input_type?: string; status: string }>(),
  reads: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        maybeSingle: async () => {
          db.reads += 1
          const row = table === "jobs" ? db.rows.get(String(filters.id)) : undefined
          return { data: row && row.user_id === filters.user_id ? row : null, error: null }
        },
      }
      return chain
    },
  },
}))

import { childStepNodeType } from "../child-step-node.js"
import { withJobSubmissionContext } from "../job-submission-context.js"
import { nodeOfJobType, PLUGIN_JOB_NODES } from "../route-node-gate.js"
import { __availabilityUniverseReadyForTests } from "../availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const PARENT = "00000000-0000-4000-8000-0000000000aa"

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(() => {
  db.rows.clear()
  db.reads = 0
  db.rows.set(PARENT, { user_id: USER, job_type: "cast-swap", status: "processing" })
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["cast-swap"] } })
  __resetSurfaceProfileCacheForTests()
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

/** A request as the auth hook leaves it. */
const request = (over: Partial<FastifyRequest> = {}) =>
  ({ method: "POST", url: "/v1/video-depth", userId: USER, authKind: "internal", ...over }) as FastifyRequest

/** `req` asked inside the scope `tk.http.workerRequest` opens for a step of `parentJobId`. */
const asStep = (req: FastifyRequest, parentJobId = PARENT, userId = USER) =>
  withJobSubmissionContext({ userId, method: "POST", url: req.url, parentJobId, trustedPluginCaller: true }, () => childStepNodeType(req))

describe("childStepNodeType", () => {
  it("a step of a running Nodaro Motion job is gated as cast-swap", async () => {
    expect(await asStep(request())).toBe("cast-swap")
  })

  it("a step of Motion's Full Quality render or a face-mask make follows cast-swap too", async () => {
    db.rows.set(PARENT, { user_id: USER, job_type: "cast-swap-full-quality", status: "processing" })
    expect(await asStep(request())).toBe("cast-swap")
    db.rows.set(PARENT, { user_id: USER, job_type: null, input_type: "cast-swap-face-mask", status: "processing" })
    expect(await asStep(request())).toBe("cast-swap")
  })

  it("a direct call — no parent job attached by server code — keeps the route's own node", async () => {
    expect(await childStepNodeType(request())).toBeUndefined()
    expect(await childStepNodeType(request({ authKind: "jwt" }))).toBeUndefined()
    // A JWT caller inside a step's scope is still no step: only internal auth is.
    expect(await asStep(request({ authKind: "jwt" }))).toBeUndefined()
    expect(db.reads).toBe(0)
  })

  it("a scope opened for another request, or for another user, lends nothing", async () => {
    const other = withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/mask-composite", parentJobId: PARENT, trustedPluginCaller: true }, () =>
      childStepNodeType(request()),
    )
    expect(await other).toBeUndefined()
    expect(await asStep(request(), PARENT, OTHER)).toBeUndefined()
  })

  it("another user's job, a finished job or an unknown job keeps the route's own node", async () => {
    db.rows.set(PARENT, { user_id: OTHER, job_type: "cast-swap", status: "processing" })
    expect(await asStep(request())).toBeUndefined()
    for (const status of ["completed", "failed", "cancelled"]) {
      db.rows.set(PARENT, { user_id: USER, job_type: "cast-swap", status })
      expect(await asStep(request()), status).toBeUndefined()
    }
    db.rows.delete(PARENT)
    expect(await asStep(request())).toBeUndefined()
  })

  it("a job no node accounts for keeps the route's own node (and says so once)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    db.rows.set(PARENT, { user_id: USER, job_type: "some-plugin-step", status: "processing" })
    expect(await asStep(request())).toBeUndefined()
    expect(await asStep(request())).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it("a deployment that does not list its nodes reads nothing and lends nothing", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["video-depth"] } })
    __resetSurfaceProfileCacheForTests()
    expect(await asStep(request())).toBeUndefined()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    expect(await asStep(request())).toBeUndefined()
    expect(db.reads).toBe(0)
  })
})

describe("nodeOfJobType", () => {
  it("a job named after its node runs as that node; a plugin job name maps through PLUGIN_JOB_NODES", () => {
    expect(nodeOfJobType("cast-swap")).toBe("cast-swap")
    expect(nodeOfJobType("generate-video-pro")).toBe("generate-video-pro")
    for (const [job, node] of Object.entries(PLUGIN_JOB_NODES)) expect(nodeOfJobType(job), job).toBe(node)
    expect(nodeOfJobType("not-a-node-or-a-job")).toBeUndefined()
  })
})
