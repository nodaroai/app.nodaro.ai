/**
 * /v1/admin/complaints (admin-complaints.ts): an admin reads the queue and a
 * case, searches by reference or email in a body (never in an address), moves
 * a case from the case they saw, notes it, names its account, matches its
 * links again, and restricts content from it; every read that shows a
 * complainant's details and every move is audited by reference, never the
 * complainant's details or what was searched; a non-admin is refused, and so
 * is an admin's API or app token (in the app only); nothing is cached; the
 * lib's refusals become 404, 409 and 400.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ids = vi.hoisted(() => ({
  CASE: "00000000-0000-4000-8000-000000000071",
  UNKNOWN: "00000000-0000-4000-8000-00000000dead",
  RACED: "00000000-0000-4000-8000-0000000000ee",
  TAKEN: "00000000-0000-4000-8000-0000000000aa",
}))
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
vi.mock("../../lib/complaint-cases.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/complaint-cases.js")>("../../lib/complaint-cases.js")
  const summary = (over: Record<string, unknown> = {}) => ({
    id: ids.CASE,
    reference: "CR-2026-000007",
    kind: "copyright",
    category: "copyright_infringement",
    status: "received",
    receivedAt: "2026-11-02T00:00:00Z",
    verifiedAt: "2026-11-02T00:05:00Z",
    userId: null,
    handlerUserId: null,
    closedAt: null,
    updatedAt: "2026-11-02T00:05:00Z",
    complainantName: "Dana Holder",
    complainantEmail: "dana@example.test",
    complainantUnreadable: [],
    reportedUrls: ["https://example.test/v"],
    matchedAssetIds: ["a-1"],
    matchedConfirmationIds: [],
    matchedUserIds: ["u-9"],
    ...over,
  })
  const missing = () => new real.ComplaintCaseError("not_found", "No such complaint")
  return {
    ...real,
    listComplaintCases: vi.fn(async (input: unknown) => {
      state.calls.push(["list", input])
      return { cases: [summary()], total: 1, page: 1, limit: 50 }
    }),
    countOpenComplaints: vi.fn(async () => 3),
    readComplaintCase: vi.fn(async (id: string) => {
      state.calls.push(["read", id])
      if (id === ids.UNKNOWN) throw missing()
      return { ...summary(), events: [], matchedAssets: [], matchedConfirmations: [], matchedUsers: [], restrictions: [], partial: [] }
    }),
    moveComplaintStatus: vi.fn(async (id: string, move: { status: string }, admin: string) => {
      state.calls.push(["status", id, move, admin])
      if (id === ids.UNKNOWN) throw missing()
      if (id === ids.RACED) throw new real.ComplaintCaseError("conflict", "The case moved meanwhile; reload it and try again")
      return summary({ status: move.status, handlerUserId: admin })
    }),
    addComplaintNote: vi.fn(async (id: string, text: string, admin: string) => {
      state.calls.push(["note", id, text, admin])
      if (id === ids.UNKNOWN) throw missing()
    }),
    nameComplaintUser: vi.fn(async (id: string, userId: string | null, seen: string, admin: string) => {
      state.calls.push(["user", id, userId, seen, admin])
      if (userId === ids.UNKNOWN) throw new real.ComplaintCaseError("invalid_move", "No such account")
      return summary({ userId })
    }),
    rematchComplaint: vi.fn(async (id: string, admin: string) => {
      state.calls.push(["rematch", id, admin])
      return summary({ matchedAssetIds: ["a-1", "a-2"] })
    }),
    restrictFromComplaint: vi.fn(async (id: string, input: { assetId?: string; jobId?: string }, admin: string) => {
      state.calls.push(["restrict", id, input, admin])
      if (input.assetId === ids.TAKEN) {
        const { ContentRestrictionError } = await vi.importActual<typeof import("../../../lib/content-restrictions.js")>("../../../lib/content-restrictions.js")
        throw new ContentRestrictionError("already_restricted", "The content is already restricted")
      }
      return { restriction: { id: "r-1" }, case: summary({ status: "content_restricted" }) }
    }),
  }
})

import { COMPLAINT_QUEUE_AUDIT_TARGET, adminComplaintsRoutes } from "../admin-complaints.js"

const USER = "00000000-0000-4000-8000-000000000001"
const { CASE, UNKNOWN, RACED, TAKEN } = ids
const ASSET = "00000000-0000-4000-8000-000000000011"
/** The case's `updatedAt` as the handler's screen showed it. */
const SEEN = "2026-11-02T00:05:00.000000+00:00"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.audits = []
  state.calls = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as typeof req.authKind) : "jwt"
  })
  await app.register(adminComplaintsRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asAdmin = { "x-user-id": USER }
const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: asAdmin, ...(payload !== undefined ? { payload: payload as object } : {}) })

describe("the queue and the case", () => {
  it("lists with the filters as given, counts the open cases, reads one case", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/complaints?status=open&kind=copyright&page=2&limit=20", headers: asAdmin })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, data: [{ reference: "CR-2026-000007" }] })
    expect(state.calls[0]).toEqual(["list", { status: "open", kind: "copyright", page: 2, limit: 20 }])
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints/count", headers: asAdmin })).json()).toEqual({ count: 3 })
    const one = await app.inject({ method: "GET", url: `/v1/admin/complaints/${CASE}`, headers: asAdmin })
    expect(one.statusCode).toBe(200)
    expect(one.json().data).toMatchObject({ id: CASE, complainantEmail: "dana@example.test" })
  })

  it("what is typed into the search is sent in a body, never in an address: the queue takes no search at all", async () => {
    for (const q of ["CR-2026", "dana%40example.test", "Jane%20Doe"]) {
      expect((await app.inject({ method: "GET", url: `/v1/admin/complaints?q=${q}`, headers: asAdmin })).statusCode).toBe(400)
    }
    expect(state.calls).toEqual([])
    const byEmail = await post("/v1/admin/complaints/search", { q: " Dana@Example.test ", status: "open", page: 1 })
    expect(byEmail.statusCode).toBe(200)
    expect(byEmail.json()).toMatchObject({ total: 1, data: [{ reference: "CR-2026-000007" }] })
    expect((await post("/v1/admin/complaints/search", { q: "CR-2026", kind: "copyright" })).statusCode).toBe(200)
    expect(state.calls).toEqual([
      ["list", { email: "Dana@Example.test", status: "open", page: 1 }],
      ["list", { reference: "CR-2026", kind: "copyright" }],
    ])
    expect((await post("/v1/admin/complaints/search", {})).statusCode).toBe(400)
    expect((await post("/v1/admin/complaints/search", { q: "a@b.c", email: "x" })).statusCode).toBe(400)
    expect((await post("/v1/admin/complaints/search", { q: "x".repeat(65) })).statusCode).toBe(400)
    expect((await post("/v1/admin/complaints/search", { q: `${"x".repeat(100)}@example.test` })).statusCode).toBe(200)
  })

  it("every read that shows a complainant's details is audited by the cases' references, never by what was searched", async () => {
    await app.inject({ method: "GET", url: "/v1/admin/complaints?status=open", headers: asAdmin })
    await post("/v1/admin/complaints/search", { q: "dana@example.test" })
    await app.inject({ method: "GET", url: `/v1/admin/complaints/${CASE}`, headers: asAdmin })
    await app.inject({ method: "GET", url: "/v1/admin/complaints/count", headers: asAdmin })
    expect(state.audits).toEqual([
      ["complaint_queue", "complaint_queue", COMPLAINT_QUEUE_AUDIT_TARGET, { status: "open", kind: null, page: 1, references: ["CR-2026-000007"] }],
      ["complaint_search", "complaint_queue", COMPLAINT_QUEUE_AUDIT_TARGET, { by: "email", status: null, kind: null, page: 1, references: ["CR-2026-000007"] }],
      ["complaint_view", "complaint", CASE, { reference: "CR-2026-000007" }],
    ])
    expect(JSON.stringify(state.audits)).not.toContain("dana@example.test")
    expect(JSON.stringify(state.audits)).not.toContain("Dana Holder")
  })

  it("refuses an unknown filter and an unknown case", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints?status=nope", headers: asAdmin })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints?limit=500", headers: asAdmin })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: `/v1/admin/complaints/${UNKNOWN}`, headers: asAdmin })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints/not-a-uuid", headers: asAdmin })).statusCode).toBe(400)
  })

  it("a non-admin is refused, and nothing is read", async () => {
    state.admin = false
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints", headers: asAdmin })).statusCode).toBe(403)
    expect((await post(`/v1/admin/complaints/${CASE}/status`, { seen: SEEN, status: "closed" })).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints" })).statusCode).toBe(401)
    expect(state.calls).toEqual([])
  })
})

describe("who is answered", () => {
  const routes = [
    { method: "GET", url: "/v1/admin/complaints" },
    { method: "POST", url: "/v1/admin/complaints/search", payload: { q: "dana@example.test" } },
    { method: "GET", url: "/v1/admin/complaints/count" },
    { method: "GET", url: `/v1/admin/complaints/${CASE}` },
    { method: "POST", url: `/v1/admin/complaints/${CASE}/status`, payload: { seen: SEEN, status: "closed" } },
    { method: "POST", url: `/v1/admin/complaints/${CASE}/notes`, payload: { text: "x" } },
    { method: "POST", url: `/v1/admin/complaints/${CASE}/user`, payload: { userId: null, seen: SEEN } },
    { method: "POST", url: `/v1/admin/complaints/${CASE}/rematch` },
    { method: "POST", url: `/v1/admin/complaints/${CASE}/restrict`, payload: { assetId: ASSET, reason: "x" } },
  ] as const

  it.each(["api_token", "app_token", "billing_key", "internal"])("an administrator's %s is refused on every route, before anything is read", async (kind) => {
    for (const route of routes) {
      const res = await app.inject({ ...route, headers: { ...asAdmin, "x-auth-kind": kind } })
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(state.calls).toEqual([])
    expect(state.audits).toEqual([])
  })

  it("nothing is cached, a refusal included", async () => {
    for (const route of routes) {
      expect((await app.inject({ ...route, headers: asAdmin })).headers["cache-control"], `${route.method} ${route.url}`).toBe("no-store")
    }
    expect((await app.inject({ method: "GET", url: "/v1/admin/complaints/count", headers: { ...asAdmin, "x-auth-kind": "api_token" } })).headers["cache-control"]).toBe("no-store")
  })
})

describe("the moves", () => {
  it("moves a case from the case the handler saw, with a decision and a note, audited by its reference and never the complainant's details", async () => {
    const res = await post(`/v1/admin/complaints/${CASE}/status`, { seen: SEEN, status: "content_restricted", decision: "The clip is the claimant's work.", note: "checked the original" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ status: "content_restricted", handlerUserId: USER })
    expect(state.calls[0]).toEqual(["status", CASE, { seen: SEEN, status: "content_restricted", decision: "The clip is the claimant's work.", note: "checked the original" }, USER])
    expect(state.audits[0]).toEqual(["complaint_status", "complaint", CASE, { reference: "CR-2026-000007", status: "content_restricted", decided: true }])
    expect(JSON.stringify(state.audits)).not.toContain("dana@example.test")
    expect(JSON.stringify(state.audits)).not.toContain("Dana Holder")
  })

  it("a move names the case as it was seen; 409 when it changed meanwhile, 404 for an unknown case, 400 for an unknown status; audits none of them", async () => {
    expect((await post(`/v1/admin/complaints/${CASE}/status`, { status: "closed" })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${RACED}/status`, { seen: SEEN, status: "closed" })).statusCode).toBe(409)
    expect((await post(`/v1/admin/complaints/${UNKNOWN}/status`, { seen: SEEN, status: "closed" })).statusCode).toBe(404)
    expect((await post(`/v1/admin/complaints/${CASE}/status`, { seen: SEEN, status: "deleted" })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${CASE}/status`, { seen: SEEN, status: "closed", extra: 1 })).statusCode).toBe(400)
    expect(state.audits).toEqual([])
  })

  it("notes a case (the note's text is the log's, the audit has its length), names its account from the case as seen, matches it again", async () => {
    expect((await post(`/v1/admin/complaints/${CASE}/notes`, { text: "asked for the original file" })).statusCode).toBe(201)
    expect((await post(`/v1/admin/complaints/${CASE}/notes`, { text: "  " })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${CASE}/user`, { userId: ASSET, seen: SEEN })).json().data).toMatchObject({ userId: ASSET })
    expect((await post(`/v1/admin/complaints/${CASE}/user`, { userId: null, seen: SEEN })).statusCode).toBe(200)
    expect((await post(`/v1/admin/complaints/${CASE}/user`, { userId: null })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${CASE}/rematch`)).json().data).toMatchObject({ matchedAssetIds: ["a-1", "a-2"] })
    expect(state.calls.filter((c) => (c as unknown[])[0] === "user")).toEqual([
      ["user", CASE, ASSET, SEEN, USER],
      ["user", CASE, null, SEEN, USER],
    ])
    expect(state.audits).toEqual([
      ["complaint_note", "complaint", CASE, { length: "asked for the original file".length }],
      ["complaint_user", "complaint", CASE, { reference: "CR-2026-000007", userId: ASSET }],
      ["complaint_user", "complaint", CASE, { reference: "CR-2026-000007", userId: null }],
      ["complaint_rematch", "complaint", CASE, { reference: "CR-2026-000007", assets: 2, confirmations: 0 }],
    ])
    expect(JSON.stringify(state.audits)).not.toContain("asked for the original file")
  })

  it("naming an account that does not exist is the handler's mistake (400), not the server's", async () => {
    const res = await post(`/v1/admin/complaints/${CASE}/user`, { userId: UNKNOWN, seen: SEEN })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "invalid_move", message: "No such account" })
    expect(state.audits).toEqual([])
  })

  it("restricts from the case, audited as a restriction naming the case; one target, and the restriction's refusals mapped", async () => {
    const res = await post(`/v1/admin/complaints/${CASE}/restrict`, { assetId: ASSET, reason: "the claimant's clip" })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ restriction: { id: "r-1" }, case: { status: "content_restricted" } })
    expect(state.calls[0]).toEqual(["restrict", CASE, { assetId: ASSET, reason: "the claimant's clip" }, USER])
    expect(state.audits[0]).toEqual(["content_restrict", "asset", ASSET, { restrictionId: "r-1", complaintId: CASE, reason: "the claimant's clip" }])
    expect((await post(`/v1/admin/complaints/${CASE}/restrict`, { reason: "x" })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${CASE}/restrict`, { assetId: ASSET, jobId: ASSET, reason: "x" })).statusCode).toBe(400)
    expect((await post(`/v1/admin/complaints/${CASE}/restrict`, { assetId: TAKEN, reason: "x" })).statusCode).toBe(409)
  })
})
