/**
 * /v1/admin/counter-notices (admin-counter-notices.ts): an administrator
 * signed in to the app forwards, records a court action and its end,
 * declines, restores; each step audited by the counter-notice's reference;
 * another credential of an administrator is refused; nothing cached; notes
 * and reasons are plain text; the refusals mapped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({ admin: true, audits: [] as unknown[], calls: [] as unknown[] }))
const ids = vi.hoisted(() => ({
  N: "00000000-0000-4000-8000-0000000000c1",
  EARLY: "00000000-0000-4000-8000-0000000000c2",
  GONE: "00000000-0000-4000-8000-0000000000c3",
  HELD: "00000000-0000-4000-8000-0000000000c4",
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.audits.push(rest)
  }),
}))
vi.mock("../../lib/counter-notice-cases.js", async () => {
  const { ComplaintCaseError } = await vi.importActual<typeof import("../../lib/complaint-case-rows.js")>("../../lib/complaint-case-rows.js")
  const { ContentRestrictionError } = await vi.importActual<typeof import("../../../lib/content-restrictions.js")>("../../../lib/content-restrictions.js")
  const step = (id: string) => ({ id, reference: "CN-2026-000001", complaintId: "c-1" })
  const check = (id: string) => {
    if (id === ids.GONE) throw new ComplaintCaseError("not_found", "No such counter-notice")
  }
  return {
    markCounterNoticeForwarded: vi.fn(async (id: string, admin: string) => {
      state.calls.push(["forwarded", id, admin])
      check(id)
      return step(id)
    }),
    recordCourtAction: vi.fn(async (id: string, note: string | null, admin: string) => {
      state.calls.push(["court", id, note, admin])
      check(id)
      return step(id)
    }),
    recordCourtActionEnded: vi.fn(async (id: string, note: string | null, admin: string) => {
      state.calls.push(["ended", id, note, admin])
      check(id)
      return step(id)
    }),
    declineCounterNotice: vi.fn(async (id: string, reason: string, admin: string) => {
      state.calls.push(["decline", id, reason, admin])
      check(id)
      return step(id)
    }),
    restoreFromCounterNotice: vi.fn(async (id: string, admin: string) => {
      state.calls.push(["restore", id, admin])
      check(id)
      if (id === ids.EARLY) throw new ComplaintCaseError("invalid_move", "The content can be restored from 2026-12-09, not before")
      if (id === ids.HELD) throw new ContentRestrictionError("court_action", "A court action holds the content")
      return { ...step(id), restriction: { id: "r-1" } }
    }),
  }
})

import { adminCounterNoticesRoutes } from "../admin-counter-notices.js"

const USER = "00000000-0000-4000-8000-000000000001"
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
  await app.register(adminCounterNoticesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asAdmin = { "x-user-id": USER }
const post = (url: string, payload?: unknown, headers: Record<string, string> = asAdmin) =>
  app.inject({ method: "POST", url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) })

const at = (step: string, id = ids.N) => `/v1/admin/counter-notices/${id}/${step}`
const routes = [at("forwarded"), at("court-action"), at("court-action-ended"), at("decline"), at("restore")]

describe("who is answered", () => {
  it.each(["api_token", "app_token", "billing_key", "internal"])("an administrator's %s is refused on every route, before anything is done", async (kind) => {
    for (const url of routes) {
      const res = await post(url, { reason: "x" }, { ...asAdmin, "x-auth-kind": kind })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(state.calls).toEqual([])
  })

  it("a non-admin is refused; nothing is cached", async () => {
    state.admin = false
    for (const url of routes) expect((await post(url, { reason: "x" })).statusCode, url).toBe(403)
    expect(state.calls).toEqual([])
    state.admin = true
    for (const url of routes) expect((await post(url, { reason: "x" })).headers["cache-control"], url).toBe("no-store")
  })
})

describe("the steps", () => {
  it("each step is taken by the administrator and audited by the counter-notice's reference", async () => {
    expect((await post(at("forwarded"))).statusCode).toBe(200)
    expect((await post(at("court-action"), { note: "District Court, 1:26-cv-1" })).statusCode).toBe(200)
    expect((await post(at("court-action-ended"), { note: "Dismissed" })).statusCode).toBe(200)
    expect((await post(at("decline"), { reason: "No physical address was given." })).statusCode).toBe(200)
    const restored = await post(at("restore"))
    expect(restored.json().data).toMatchObject({ id: ids.N, reference: "CN-2026-000001", restriction: { id: "r-1" } })
    expect(state.calls).toEqual([
      ["forwarded", ids.N, USER],
      ["court", ids.N, "District Court, 1:26-cv-1", USER],
      ["ended", ids.N, "Dismissed", USER],
      ["decline", ids.N, "No physical address was given.", USER],
      ["restore", ids.N, USER],
    ])
    const ref = { reference: "CN-2026-000001", complaintId: "c-1" }
    expect(state.audits).toEqual([
      ["counter_notice_forwarded", "counter_notice", ids.N, ref],
      ["counter_notice_court_action", "counter_notice", ids.N, ref],
      ["counter_notice_court_action_ended", "counter_notice", ids.N, ref],
      ["counter_notice_decline", "counter_notice", ids.N, ref],
      ["counter_notice_restore", "counter_notice", ids.N, { ...ref, restrictionId: "r-1" }],
    ])
  })

  it("a court action's notes are optional; a decline says why; nothing else is taken", async () => {
    expect((await post(at("court-action"))).statusCode).toBe(200)
    expect((await post(at("court-action-ended"), {})).statusCode).toBe(200)
    expect(state.calls).toEqual([
      ["court", ids.N, null, USER],
      ["ended", ids.N, null, USER],
    ])
    expect((await post(at("court-action"), { note: "x", extra: 1 })).statusCode).toBe(400)
    expect((await post(at("decline"), {})).statusCode).toBe(400)
    expect((await post(at("decline"), { reason: "   " })).statusCode).toBe(400)
    expect((await post(at("decline"), { reason: "x".repeat(2001) })).statusCode).toBe(400)
  })

  it("notes and reasons are plain text: line breaks kept, control characters and invisible marks refused", async () => {
    expect((await post(at("decline"), { reason: "No address.\r\nNo phone." })).statusCode).toBe(200)
    expect(state.calls[0]).toEqual(["decline", ids.N, "No address.\nNo phone.", USER])
    expect((await post(at("decline"), { reason: `No address${String.fromCharCode(0x202e)}.` })).statusCode).toBe(400)
    expect((await post(at("court-action"), { note: `Court${String.fromCharCode(0)}` })).statusCode).toBe(400)
  })

  it("maps the refusals: too early is the handler's (400), a court action holding the content 409, unknown 404, a bad id 400; none audited", async () => {
    expect((await post(at("restore", ids.EARLY))).statusCode).toBe(400)
    const held = await post(at("restore", ids.HELD))
    expect(held.statusCode).toBe(409)
    expect(held.json().error.code).toBe("court_action")
    expect((await post(at("forwarded", ids.GONE))).statusCode).toBe(404)
    expect((await post("/v1/admin/counter-notices/not-a-uuid/restore")).statusCode).toBe(400)
    expect(state.audits).toEqual([])
  })
})
