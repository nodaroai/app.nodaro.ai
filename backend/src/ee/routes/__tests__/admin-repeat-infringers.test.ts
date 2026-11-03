/**
 * /v1/admin/... repeat infringers (admin-repeat-infringers.ts): an
 * administrator signed in to the app records and withdraws an infringement,
 * takes and lifts a measure, reads and saves the policy; every move audited
 * (a closure's block as an account block too, and what became of it); a move
 * from a case names the account the screen showed; another credential of an
 * administrator is refused; nothing cached; reasons and notes are plain text;
 * days are an import block's only; the refusals mapped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  admin: true,
  audits: [] as unknown[],
  blocks: [] as unknown[],
  calls: [] as unknown[],
  saved: null as unknown,
  stored: { policy: { windowMonths: 24, steps: [{ infringements: 1, kind: "warning" }] }, saved: false, updatedAt: null } as Record<string, unknown>,
  signInError: null as unknown,
  closure: "placed" as "placed" | "refused" | "refused-unlifted" | "failed",
}))
const ids = vi.hoisted(() => ({
  CASE: "00000000-0000-4000-8000-0000000000d1",
  GONE: "00000000-0000-4000-8000-0000000000d2",
  ROW: "00000000-0000-4000-8000-0000000000d3",
  OWNER: "00000000-0000-4000-8000-0000000000d4",
  INF: "00000000-0000-4000-8000-0000000000d5",
  MOVED: "00000000-0000-4000-8000-0000000000d6",
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.audits.push(rest)
  }),
}))
vi.mock("../../lib/admin-actions.js", () => ({
  recordAdminAction: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.blocks.push(rest)
  }),
}))
vi.mock("../../lib/account-blocking.js", () => ({ BLOCK_REFUSAL_MESSAGE: { target_is_admin: "Admins cannot be blocked. Change the role first." } }))
vi.mock("../../../lib/repeat-infringer-policy-store.js", () => ({
  readRepeatInfringerPolicy: vi.fn(async () => state.stored),
  saveRepeatInfringerPolicy: vi.fn(async (policy: unknown, admin: string) => {
    state.saved = [policy, admin]
    state.stored = { policy, saved: true, updatedAt: "2026-11-03T12:00:00.000Z" }
  }),
}))
vi.mock("../../lib/repeat-infringers.js", async () => {
  const { RepeatInfringerError } = await vi.importActual<typeof import("../../lib/repeat-infringer-error.js")>("../../lib/repeat-infringer-error.js")
  const refuse = (id: string, userId?: string) => {
    if (id === ids.GONE) throw new RepeatInfringerError("not_found", "No such complaint")
    if (userId === ids.MOVED) throw new RepeatInfringerError("case_moved", "The case names another account now: read it again")
  }
  const infringement = { id: ids.ROW, complaint_id: ids.CASE, user_id: ids.OWNER, recorded_at: "2026-11-03T12:00:00.000Z", withdrawn_at: "2026-11-03T13:00:00.000Z" }
  const closureBlock = () => {
    if (state.closure === "refused") return { placed: false, refused: "target_is_admin", lifted: { id: ids.ROW } }
    if (state.closure === "refused-unlifted") return { placed: false, refused: "target_is_admin", lifted: null }
    if (state.closure === "failed") return { placed: false, failure: new Error("blocks down") }
    return { placed: true, signInBlocked: state.signInError === null, signInError: state.signInError }
  }
  return {
    recordInfringement: vi.fn(async (caseId: string, userId: string, note: string | null, admin: string) => {
      state.calls.push(["record", caseId, userId, note, admin])
      refuse(caseId, userId)
      return infringement
    }),
    withdrawInfringement: vi.fn(async (id: string, reason: string, admin: string) => {
      state.calls.push(["withdraw", id, reason, admin])
      refuse(id)
      return infringement
    }),
    applyMeasure: vi.fn(async (input: Record<string, unknown>, admin: string) => {
      state.calls.push(["apply", input, admin])
      refuse(String(input.complaintId), String(input.userId))
      if (input.reason === "unavailable") throw new RepeatInfringerError("unavailable", "Not yet")
      if (input.reason === "depart") throw new RepeatInfringerError("departure_required", "Say why")
      if (input.reason === "unverified") throw new RepeatInfringerError("unverified", "Not evidence yet")
      if (input.reason === "admin") throw new RepeatInfringerError("target_is_admin", "Admins cannot be blocked. Change the role first.")
      if (input.reason === "twice") throw new RepeatInfringerError("in_force", "In force already")
      const measure = { id: ids.ROW, user_id: ids.OWNER, complaint_id: ids.CASE, kind: input.kind, ends_at: null, policy_step: input.departureReason ? null : { infringements: 1 } }
      return { measure, block: input.kind === "closed" ? closureBlock() : null }
    }),
    liftMeasure: vi.fn(async (id: string, reason: string, admin: string) => {
      state.calls.push(["lift", id, reason, admin])
      refuse(id)
      return { measure: { id, user_id: ids.OWNER, complaint_id: ids.CASE, kind: "closed", lifted_at: "2026-11-03T13:00:00.000Z" }, stillBlocked: true }
    }),
  }
})

import { adminRepeatInfringersRoutes, REPEAT_INFRINGER_POLICY_AUDIT_TARGET } from "../admin-repeat-infringers.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.audits = []
  state.blocks = []
  state.calls = []
  state.saved = null
  state.signInError = null
  state.closure = "placed"
  state.stored = { policy: { windowMonths: 24, steps: [{ infringements: 1, kind: "warning" }] }, saved: false, updatedAt: null }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as typeof req.authKind) : "jwt"
  })
  await app.register(adminRepeatInfringersRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const asAdmin = { "x-user-id": USER }
const send = (method: "POST" | "PUT" | "GET", url: string, payload?: unknown, headers: Record<string, string> = asAdmin) =>
  app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) })
const post = (url: string, payload?: unknown, headers?: Record<string, string>) => send("POST", url, payload, headers)

const RECORD = `/v1/admin/complaints/${ids.CASE}/infringement`
const WITHDRAW = `/v1/admin/infringements/${ids.ROW}/withdraw`
const MEASURE = `/v1/admin/complaints/${ids.CASE}/measure`
const LIFT = `/v1/admin/measures/${ids.ROW}/lift`
const POLICY = "/v1/admin/repeat-infringer-policy"
const VALID_POLICY = { windowMonths: 12, steps: [{ infringements: 1, kind: "warning" }, { infringements: 2, kind: "closed" }] }
const routes: Array<["POST" | "PUT" | "GET", string, unknown]> = [
  ["POST", RECORD, { userId: ids.OWNER }],
  ["POST", WITHDRAW, { reason: "x" }],
  ["POST", MEASURE, { userId: ids.OWNER, kind: "warning", reason: "x" }],
  ["POST", LIFT, { reason: "x" }],
  ["GET", POLICY, undefined],
  ["PUT", POLICY, VALID_POLICY],
]
const measure = (over: Record<string, unknown>) => post(MEASURE, { userId: ids.OWNER, ...over })

describe("who is answered", () => {
  it.each(["api_token", "app_token", "billing_key", "internal"])("an administrator's %s is refused on every route, before anything is done", async (kind) => {
    for (const [method, url, body] of routes) {
      const res = await send(method, url, body, { ...asAdmin, "x-auth-kind": kind })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(state.calls).toEqual([])
    expect(state.saved).toBeNull()
  })

  it("a non-admin is refused; nothing is cached", async () => {
    state.admin = false
    for (const [method, url, body] of routes) expect((await send(method, url, body)).statusCode, url).toBe(403)
    expect(state.calls).toEqual([])
    state.admin = true
    for (const [method, url, body] of routes) expect((await send(method, url, body)).headers["cache-control"], url).toBe("no-store")
  })
})

describe("infringements", () => {
  it("records one against the account the screen showed, with an optional note, as the administrator, audited", async () => {
    const res = await post(RECORD, { userId: ids.OWNER, note: "The film is the complainant's.\r\nSee the link." })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ id: ids.ROW, complaintId: ids.CASE, recordedAt: "2026-11-03T12:00:00.000Z" })
    expect((await post(RECORD, { userId: ids.OWNER })).statusCode).toBe(200)
    expect(state.calls).toEqual([
      ["record", ids.CASE, ids.OWNER, "The film is the complainant's.\nSee the link.", USER],
      ["record", ids.CASE, ids.OWNER, null, USER],
    ])
    expect(state.audits[0]).toEqual(["infringement_record", "account_infringement", ids.ROW, { complaintId: ids.CASE, userId: ids.OWNER }])
  })

  it("needs the account the screen showed, and a case that names another now is a 409", async () => {
    expect((await post(RECORD, {})).statusCode).toBe(400)
    expect((await post(RECORD, { userId: "not-a-uuid" })).statusCode).toBe(400)
    const moved = await post(RECORD, { userId: ids.MOVED })
    expect(moved.statusCode).toBe(409)
    expect(moved.json().error.code).toBe("case_moved")
    expect(state.audits).toEqual([])
  })

  it("withdraws one with the reason, audited; a reason is needed", async () => {
    expect((await post(WITHDRAW, { reason: "Restored after a counter-notice" })).json().data).toEqual({ id: ids.ROW, complaintId: ids.CASE, withdrawnAt: "2026-11-03T13:00:00.000Z" })
    expect(state.audits).toEqual([["infringement_withdraw", "account_infringement", ids.ROW, { complaintId: ids.CASE, userId: ids.OWNER }]])
    expect((await post(WITHDRAW, {})).statusCode).toBe(400)
    expect((await post(WITHDRAW, { reason: "  " })).statusCode).toBe(400)
  })

  it("notes and reasons are plain text, and nothing else is taken", async () => {
    expect((await post(RECORD, { userId: ids.OWNER, note: `Theirs${String.fromCharCode(0x202e)}` })).statusCode).toBe(400)
    expect((await post(WITHDRAW, { reason: `Appeal${String.fromCharCode(7)}` })).statusCode).toBe(400)
    expect((await post(RECORD, { userId: ids.OWNER, note: "x", kind: "warning" })).statusCode).toBe(400)
    expect((await post(RECORD, { userId: ids.OWNER, note: "x".repeat(4001) })).statusCode).toBe(400)
    expect(state.calls).toEqual([])
  })
})

describe("measures", () => {
  it("takes one with what the owner is told, the note, the infringement it follows and a departure's reason, audited", async () => {
    const res = await measure({ kind: "imports_blocked", days: 30, reason: "Repeated complaints", note: "Third one this year", infringementId: ids.INF, departureReason: "Longer than the policy's" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ id: ids.ROW, kind: "imports_blocked", endsAt: null, followsPolicy: false, signInBlocked: null, warning: null })
    expect(state.calls).toEqual([
      [
        "apply",
        { complaintId: ids.CASE, userId: ids.OWNER, kind: "imports_blocked", days: 30, reason: "Repeated complaints", note: "Third one this year", infringementId: ids.INF, departureReason: "Longer than the policy's" },
        USER,
      ],
    ])
    expect(state.audits).toEqual([["measure_apply", "account_sanction", ids.ROW, { complaintId: ids.CASE, userId: ids.OWNER, kind: "imports_blocked", endsAt: null, followsPolicy: false }]])
    expect(state.blocks).toEqual([])
  })

  it("a warning or a block until lifted needs no days; blank optional fields are none", async () => {
    await measure({ kind: "warning", reason: "A first warning", note: "", departureReason: "" })
    await measure({ kind: "imports_blocked", days: null, reason: "Until lifted" })
    expect(state.calls).toEqual([
      ["apply", { complaintId: ids.CASE, userId: ids.OWNER, kind: "warning", days: null, reason: "A first warning", note: null, infringementId: null, departureReason: null }, USER],
      ["apply", { complaintId: ids.CASE, userId: ids.OWNER, kind: "imports_blocked", days: null, reason: "Until lifted", note: null, infringementId: null, departureReason: null }, USER],
    ])
  })

  it("a closure whose block was placed is audited as an account block too; a sign-in ban that failed is a warning", async () => {
    const res = await measure({ kind: "closed", reason: "Repeated infringement" })
    expect(res.json().data).toMatchObject({ kind: "closed", signInBlocked: true, warning: null, followsPolicy: true })
    expect(state.audits[0]).toEqual(["measure_apply", "account_sanction", ids.ROW, { complaintId: ids.CASE, userId: ids.OWNER, kind: "closed", endsAt: null, followsPolicy: true, block: "placed" }])
    expect(state.blocks).toEqual([["account_block", ids.OWNER, { signInBlocked: true, closure: ids.ROW }, "Closed under the repeat-infringer policy"]])
    state.signInError = new Error("auth down")
    const failed = await measure({ kind: "closed", reason: "Repeated infringement" })
    expect(failed.json().data).toMatchObject({ signInBlocked: false, warning: "The account is blocked, but blocking its sign-in failed. Block it again from its page to retry." })
  })

  it("a closure the block refused late is a 403 saying it was taken back, audited as taken and lifted, and never as a block", async () => {
    state.closure = "refused"
    const res = await measure({ kind: "closed", reason: "Repeated infringement" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "target_is_admin", message: "Admins cannot be blocked. Change the role first. The closure was taken back." })
    expect(state.audits.map((a) => (a as unknown[])[0])).toEqual(["measure_apply", "measure_lift"])
    expect((state.audits[0] as unknown[])[3]).toMatchObject({ block: "refused" })
    expect(state.blocks).toEqual([])
  })

  it("a closure refused late that could not be taken back says it stands", async () => {
    state.closure = "refused-unlifted"
    const res = await measure({ kind: "closed", reason: "Repeated infringement" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toBe("Admins cannot be blocked. Change the role first. The closure stands: lift it from the case.")
    expect(state.audits.map((a) => (a as unknown[])[0])).toEqual(["measure_apply"])
  })

  it("a closure whose block failed stands, and the answer says to block the account from its page", async () => {
    state.closure = "failed"
    const res = await measure({ kind: "closed", reason: "Repeated infringement" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ kind: "closed", signInBlocked: null, warning: "The closure is recorded, but blocking the account failed: block it from the account's page." })
    expect((state.audits[0] as unknown[])[3]).toMatchObject({ block: "failed" })
    expect(state.blocks).toEqual([])
  })

  it("refuses a kind it does not know, days on anything but an import block, days out of range, no reason, no account, and a bad id", async () => {
    const bad = [
      { userId: ids.OWNER, kind: "suspended", reason: "x" },
      { userId: ids.OWNER, kind: "warning", days: 3, reason: "x" },
      { userId: ids.OWNER, kind: "closed", days: 3, reason: "x" },
      { userId: ids.OWNER, kind: "imports_blocked", days: 0, reason: "x" },
      { userId: ids.OWNER, kind: "imports_blocked", days: 3651, reason: "x" },
      { userId: ids.OWNER, kind: "imports_blocked", days: 1.5, reason: "x" },
      { userId: ids.OWNER, kind: "warning" },
      { userId: ids.OWNER, kind: "warning", reason: "" },
      { userId: ids.OWNER, kind: "warning", reason: "x", infringementId: "not-a-uuid" },
      { userId: ids.OWNER, kind: "warning", reason: "x", extra: true },
      { userId: ids.OWNER, kind: "warning", reason: `x${String.fromCharCode(0x2066)}` },
      { kind: "warning", reason: "x" },
      { userId: "not-a-uuid", kind: "warning", reason: "x" },
    ]
    for (const body of bad) expect((await post(MEASURE, body)).statusCode, JSON.stringify(body)).toBe(400)
    expect(state.calls).toEqual([])
  })

  it("lifts one with the reason, audited, and says whether the account is still blocked", async () => {
    const res = await post(LIFT, { reason: "Closed in error" })
    expect(res.json().data).toEqual({ id: ids.ROW, kind: "closed", liftedAt: "2026-11-03T13:00:00.000Z", stillBlocked: true })
    expect(state.audits).toEqual([["measure_lift", "account_sanction", ids.ROW, { complaintId: ids.CASE, userId: ids.OWNER, kind: "closed" }]])
    expect((await post(LIFT, {})).statusCode).toBe(400)
  })

  it("maps the refusals: unknown 404, not yet in the database 503, a move the case does not allow 400, an account the block refuses 403, in force or moved 409; none audited", async () => {
    expect((await post(`/v1/admin/complaints/${ids.GONE}/measure`, { userId: ids.OWNER, kind: "warning", reason: "x" })).statusCode).toBe(404)
    expect((await measure({ kind: "warning", reason: "unavailable" })).statusCode).toBe(503)
    expect((await measure({ kind: "warning", reason: "depart" })).statusCode).toBe(400)
    expect((await measure({ kind: "warning", reason: "unverified" })).statusCode).toBe(400)
    const admin = await measure({ kind: "closed", reason: "admin" })
    expect(admin.statusCode).toBe(403)
    expect(admin.json().error).toEqual({ code: "target_is_admin", message: "Admins cannot be blocked. Change the role first." })
    expect((await measure({ kind: "imports_blocked", reason: "twice" })).statusCode).toBe(409)
    expect((await post(MEASURE, { userId: ids.MOVED, kind: "warning", reason: "x" })).statusCode).toBe(409)
    expect((await post(`/v1/admin/infringements/${ids.GONE}/withdraw`, { reason: "x" })).statusCode).toBe(404)
    expect((await post("/v1/admin/measures/not-a-uuid/lift", { reason: "x" })).statusCode).toBe(404)
    expect((await post("/v1/admin/complaints/not-a-uuid/infringement", { userId: ids.OWNER })).statusCode).toBe(404)
    expect(state.audits).toEqual([])
    expect(state.blocks).toEqual([])
  })
})

describe("the policy", () => {
  it("reads the policy, the default until one is saved", async () => {
    expect((await send("GET", POLICY)).json().data).toEqual(state.stored)
  })

  it("saves a valid one as the administrator, audited with what it replaced", async () => {
    const first = await send("PUT", POLICY, VALID_POLICY)
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toEqual({ policy: VALID_POLICY, saved: true, updatedAt: "2026-11-03T12:00:00.000Z" })
    expect(state.saved).toEqual([VALID_POLICY, USER])
    expect(state.audits).toEqual([["repeat_infringer_policy_update", "app_setting", REPEAT_INFRINGER_POLICY_AUDIT_TARGET, { key: "rights_repeat_infringer_policy", before: null, after: VALID_POLICY }]])
    const second = { ...VALID_POLICY, windowMonths: 36 }
    await send("PUT", POLICY, second)
    expect(state.audits[1]).toEqual(["repeat_infringer_policy_update", "app_setting", REPEAT_INFRINGER_POLICY_AUDIT_TARGET, { key: "rights_repeat_infringer_policy", before: VALID_POLICY, after: second }])
  })

  it("refuses a ladder whose steps do not climb, a step after a closure, or a stray field; saves nothing", async () => {
    for (const body of [
      { windowMonths: 12, steps: [{ infringements: 2, kind: "warning" }, { infringements: 2, kind: "closed" }] },
      { windowMonths: 12, steps: [{ infringements: 1, kind: "closed" }, { infringements: 2, kind: "warning" }] },
      { ...VALID_POLICY, note: "x" },
      { windowMonths: 0, steps: VALID_POLICY.steps },
    ]) {
      expect((await send("PUT", POLICY, body)).statusCode, JSON.stringify(body)).toBe(400)
    }
    expect(state.saved).toBeNull()
    expect(state.audits).toEqual([])
  })
})
