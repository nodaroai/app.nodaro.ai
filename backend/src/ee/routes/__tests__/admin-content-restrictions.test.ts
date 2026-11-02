/**
 * /v1/admin/content-restrictions (admin-content-restrictions.ts): an admin
 * restricts a file or a job with a reason, lifts a restriction, reads the
 * records; every change is audited; a non-admin is refused; one target per
 * restriction; the lib's refusals become 404 and 409.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  admin: true,
  audits: [] as unknown[],
  calls: [] as unknown[],
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.audits.push(rest)
  }),
}))
vi.mock("../../../lib/content-restrictions.js", async () => {
  const real = await vi.importActual<typeof import("../../../lib/content-restrictions.js")>("../../../lib/content-restrictions.js")
  const record = (over: Record<string, unknown>) => ({
    id: "r-1",
    assetId: null,
    jobId: null,
    r2Keys: [],
    contentHash: null,
    sourceUrl: null,
    ownerUserId: "u1",
    reason: "x",
    complaintId: null,
    restrictedBy: "admin",
    restrictedAt: "2026-11-02T00:00:00Z",
    liftedBy: null,
    liftedAt: null,
    liftReason: null,
    ...over,
  })
  return {
    ...real,
    restrictAsset: vi.fn(async (assetId: string, input: unknown) => {
      state.calls.push(["asset", assetId, input])
      if (assetId === "00000000-0000-4000-8000-00000000dead") throw new real.ContentRestrictionError("not_found", "No such file")
      return record({ assetId })
    }),
    restrictJob: vi.fn(async (jobId: string, input: unknown) => {
      state.calls.push(["job", jobId, input])
      if (jobId === "00000000-0000-4000-8000-0000000000aa") throw new real.ContentRestrictionError("already_restricted", "The job is already restricted")
      if (jobId === "00000000-0000-4000-8000-0000000000bb") throw new real.ContentRestrictionError("job_not_finished", "not finished")
      if ((input as { complaintId?: string | null }).complaintId === "00000000-0000-4000-8000-0000000000cc") throw new real.ContentRestrictionError("unknown_complaint", "No such complaint")
      return record({ jobId })
    }),
    liftRestriction: vi.fn(async (id: string, input: unknown) => {
      state.calls.push(["lift", id, input])
      return record({ id, assetId: "00000000-0000-4000-8000-000000000011", liftedAt: "2026-11-02T01:00:00Z", liftedBy: "admin" })
    }),
    listRestrictions: vi.fn(async (opts: unknown) => {
      state.calls.push(["list", opts])
      return [record({})]
    }),
  }
})

import { adminContentRestrictionsRoutes } from "../admin-content-restrictions.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ASSET = "00000000-0000-4000-8000-000000000011"
const JOB = "00000000-0000-4000-8000-000000000022"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.audits = []
  state.calls = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(adminContentRestrictionsRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asAdmin = { "x-user-id": USER }

describe("POST /v1/admin/content-restrictions", () => {
  it("restricts a file with a reason and a complaint, and audits it", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { assetId: ASSET, reason: "complaint CR-2026-000001", complaintId: "00000000-0000-4000-8000-000000000033" } })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ assetId: ASSET })
    expect(state.calls[0]).toEqual(["asset", ASSET, { reason: "complaint CR-2026-000001", complaintId: "00000000-0000-4000-8000-000000000033", adminUserId: USER }])
    expect(state.audits[0]).toEqual(["content_restrict", "asset", ASSET, { restrictionId: "r-1", complaintId: "00000000-0000-4000-8000-000000000033", reason: "complaint CR-2026-000001" }])
  })

  it("restricts a job the same way; one target per restriction, and a reason is required", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { jobId: JOB, reason: "complaint" } })
    expect(res.statusCode).toBe(201)
    expect(state.calls[0]).toEqual(["job", JOB, { reason: "complaint", complaintId: null, adminUserId: USER }])
    for (const bad of [{ assetId: ASSET, jobId: JOB, reason: "x" }, { reason: "x" }, { assetId: ASSET }]) {
      expect((await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: bad })).statusCode).toBe(400)
    }
  })

  it("an unknown file is 404, a job restricted already or not finished is 409, an unknown complaint is 400", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { assetId: "00000000-0000-4000-8000-00000000dead", reason: "x" } })).statusCode).toBe(404)
    expect((await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { jobId: "00000000-0000-4000-8000-0000000000aa", reason: "x" } })).statusCode).toBe(409)
    expect((await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { jobId: "00000000-0000-4000-8000-0000000000bb", reason: "x" } })).statusCode).toBe(409)
    expect((await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { jobId: JOB, reason: "x", complaintId: "00000000-0000-4000-8000-0000000000cc" } })).statusCode).toBe(400)
    expect(state.audits).toEqual([])
  })

  it("a non-admin is refused", async () => {
    state.admin = false
    const res = await app.inject({ method: "POST", url: "/v1/admin/content-restrictions", headers: asAdmin, payload: { assetId: ASSET, reason: "x" } })
    expect(res.statusCode).toBe(403)
    expect(state.calls).toEqual([])
  })
})

describe("the lift and the list", () => {
  it("lifts with a reason and audits it", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/content-restrictions/00000000-0000-4000-8000-000000000044/lift", headers: asAdmin, payload: { reason: "counter-notice" } })
    expect(res.statusCode).toBe(200)
    expect(state.calls[0]).toEqual(["lift", "00000000-0000-4000-8000-000000000044", { reason: "counter-notice", adminUserId: USER }])
    expect(state.audits[0]).toEqual(["content_restriction_lift", "asset", ASSET, { restrictionId: "00000000-0000-4000-8000-000000000044", reason: "counter-notice" }])
  })

  it("lists every record, or the active ones", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/content-restrictions", headers: asAdmin })).json().data).toHaveLength(1)
    await app.inject({ method: "GET", url: "/v1/admin/content-restrictions?active=1", headers: asAdmin })
    expect(state.calls).toEqual([["list", { active: false }], ["list", { active: true }]])
  })
})
