import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The INTEGRATION half of the allowance module (migration 387): `set`,
 * `renew`, the pending grant, and the two identity lookups.
 *
 * What these tests exist to pin, in one line each:
 *
 *   THE CLASSIFIER IS TOTAL. Every exception prefix the RPC can raise maps to
 *   a code the route turns into a status. A prefix nobody mapped becomes
 *   `allowance_write_failed` — a 500 that reads as "we broke" for what is
 *   actually a business refusal the caller can act on. The two new prefixes
 *   are the ones a machine will hit first, because a machine is the only
 *   caller that can send a mode or a target at all.
 *
 *   THE SIGN-IN NEVER PAYS FOR A QUOTA. `applyPendingAllowance` runs on every
 *   successful SSO sign-in, so it must swallow everything: an error, a throw,
 *   a deployment with no payer. A rejected promise there would turn a working
 *   login into a 500 over an allowance that could be applied a minute later.
 *
 *   AMBIGUOUS IS A REFUSAL. Two accounts answering to one address — the same
 *   address in two cases is the realistic shape — must never resolve to one of
 *   them. Allocating a paid quota to an arbitrary half of a split identity is
 *   the failure that costs the customer money.
 *
 *   NOTHING MULTIPLIES BY THE UNIT RATE (R3). The ledger is in RAW Nodaro
 *   credits; a display unit that reached `set_deployment_allowance` would make
 *   the stored allowance wrong the day the rate moved — and a stored figure,
 *   unlike a rendered one, stays wrong.
 */

const rpc = vi.fn()
const from = vi.fn()
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}))

import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import {
  applyPendingAllowance,
  grantAllowance,
  resolveUserRef,
  setAllowance,
  ssoSubjectsFor,
  writePendingAllowance,
  __resetDeploymentAllowanceCacheForTests,
} from "../deployment-allowance-service.js"

const PAYER = "00000000-0000-4000-8000-000000000001"
const U1 = "00000000-0000-4000-8000-000000000101"
const U2 = "00000000-0000-4000-8000-000000000102"
const KEY = "00000000-0000-4000-8000-0000000000c1"

const REAL_EDITION = config.EDITION
const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

type Res = { data: unknown; error: { message: string } | null }
let profileRow: Res
let profileList: Res
let pendingDelete: Res
let pendingInsert: Res
let calls: Array<{ table: string; op: string; args: unknown[] }>

/** Drive the REAL payer predicate, not a mock of it. */
function payerDeployment(): void {
  config.EDITION = "business"
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { unitLabel: "credits", unitRate: 2000, selfServe: false },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

function tableStub(table: string) {
  const record = (op: string, ...args: unknown[]) => {
    calls.push({ table, op, args })
  }
  return {
    select: (cols: string) => {
      record("select", cols)
      return {
        eq: (c: string, v: unknown) => {
          record("eq", c, v)
          return { maybeSingle: async () => profileRow }
        },
        ilike: (c: string, v: unknown) => {
          record("ilike", c, v)
          return { limit: async (n: number) => (record("limit", n), profileList) }
        },
      }
    },
    delete: () => {
      record("delete")
      return {
        is: (c: string, v: unknown) => {
          record("is", c, v)
          return {
            eq: async (c2: string, v2: unknown) => (record("eq", c2, v2), pendingDelete),
          }
        },
      }
    },
    insert: (row: Record<string, unknown>) => {
      record("insert", row)
      return {
        select: () => ({ maybeSingle: async () => pendingInsert }),
      }
    },
  }
}

beforeEach(() => {
  calls = []
  profileRow = { data: null, error: null }
  profileList = { data: [], error: null }
  pendingDelete = { data: null, error: null }
  pendingInsert = { data: { id: "pending-1", expires_at: "2026-12-05T00:00:00.000Z" }, error: null }
  rpc.mockReset()
  from.mockReset()
  from.mockImplementation((table: string) => tableStub(table))
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  __resetDeploymentAllowanceCacheForTests()
  __resetDeploymentPayerForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  config.EDITION = REAL_EDITION
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

/** The RPC's success shape: PostgREST answers a RETURNS TABLE function with an
 *  array of rows, even when the function returns exactly one. */
function rpcRow(over: Record<string, unknown> = {}): Res {
  return {
    data: [
      {
        applied: "set",
        granted_credits: 400,
        reserved_credits: 0,
        spent_credits: 0,
        reset_at: null,
        ...over,
      },
    ],
    error: null,
  }
}

describe("setAllowance — the RPC call itself", () => {
  it("passes all SIX arguments, in RAW credits, and never multiplies by the unit rate", async () => {
    payerDeployment()
    rpc.mockResolvedValue(rpcRow())

    const result = await setAllowance({
      userId: U1,
      targetCredits: 400,
      actorId: PAYER,
      mode: "set",
      note: "plan A",
      credentialId: KEY,
    })

    expect(result).toEqual({ ok: true, applied: "set", row: { granted: 400, remaining: 400, spent: 0 } })
    // 400 credits, not 800 000 units. The unit rate is 2000 on this
    // deployment's profile and it must not appear anywhere on this path.
    expect(rpc).toHaveBeenCalledWith("set_deployment_allowance", {
      p_user_id: U1,
      p_target_credits: 400,
      p_actor_id: PAYER,
      p_mode: "set",
      p_note: "plan A",
      p_credential_id: KEY,
    })
  })

  it("sends a null credential when the caller has none — the page, not a key", async () => {
    payerDeployment()
    rpc.mockResolvedValue(rpcRow())
    await setAllowance({ userId: U1, targetCredits: 400, actorId: PAYER, mode: "set", note: null })
    expect((rpc.mock.calls[0]?.[1] as { p_credential_id: unknown }).p_credential_id).toBeNull()
  })

  it("a renewal surfaces resetAt, so a renderer can say \"this period\" truthfully", async () => {
    payerDeployment()
    rpc.mockResolvedValue(
      rpcRow({ applied: "renew", granted_credits: 300, reserved_credits: 20, spent_credits: 0, reset_at: "2026-09-06T00:00:00.000Z" }),
    )
    const result = await setAllowance({ userId: U1, targetCredits: 300, actorId: PAYER, mode: "renew", note: null })
    expect(result).toEqual({
      ok: true,
      applied: "renew",
      row: { granted: 300, remaining: 280, spent: 0, resetAt: "2026-09-06T00:00:00.000Z" },
    })
  })

  it("a row with no reset_at OMITS resetAt rather than answering null", async () => {
    // The key's absence is what tells a renderer that `spent` is a LIFETIME
    // figure and "this period" would be a lie.
    payerDeployment()
    rpc.mockResolvedValue(rpcRow())
    const result = await setAllowance({ userId: U1, targetCredits: 400, actorId: PAYER, mode: "set", note: null })
    expect(result.ok && "resetAt" in result.row).toBe(false)
  })

  it("a replayed set is a SUCCESS with applied = noop — not an error, not a second top-up", async () => {
    payerDeployment()
    rpc.mockResolvedValue(rpcRow({ applied: "noop" }))
    const result = await setAllowance({ userId: U1, targetCredits: 400, actorId: PAYER, mode: "set", note: null })
    expect(result).toEqual({ ok: true, applied: "noop", row: { granted: 400, remaining: 400, spent: 0 } })
  })

  it("refuses when the function answers no row — that is a fault, never \"nothing changed\"", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: [], error: null })
    const result = await setAllowance({ userId: U1, targetCredits: 400, actorId: PAYER, mode: "set", note: null })
    expect(result).toEqual({
      ok: false,
      code: "allowance_write_failed",
      message: "set_deployment_allowance returned no row",
    })
  })
})

describe("the prefix classifier — 387's two new refusals", () => {
  const cases: Array<[string, string]> = [
    ["ALLOWANCE_MODE_INVALID: mode grant is not one of set, renew", "allowance_mode_invalid"],
    ["ALLOWANCE_TARGET_INVALID: target -1 must be zero or a positive whole number of credits", "allowance_target_invalid"],
    ["ALLOWANCE_BELOW_COMMITTED: renewal target 10, below reserved 20", "allowance_below_committed"],
    ["ALLOWANCE_ACTOR_NOT_PAYER: only the deployment billing account may change an allowance", "allowance_actor_not_payer"],
    ["ALLOWANCE_UNCONFIGURED: deployment_payer_settings names no payer", "allowance_unconfigured"],
  ]

  for (const [raw, code] of cases) {
    it(`maps ${raw.split(":")[0]} to ${code}`, async () => {
      payerDeployment()
      rpc.mockResolvedValue({ data: null, error: { message: raw } })
      const result = await setAllowance({ userId: U1, targetCredits: 1, actorId: PAYER, mode: "set", note: null })
      expect(result).toEqual({ ok: false, code, message: raw })
    })
  }

  it("an unrecognised database error stays allowance_write_failed", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } })
    const result = await setAllowance({ userId: U1, targetCredits: 1, actorId: PAYER, mode: "set", note: null })
    expect(result).toEqual({ ok: false, code: "allowance_write_failed", message: "deadlock detected" })
  })

  it("matches on the PREFIX, so a message merely CONTAINING a prefix is not misread", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: { message: "some wrapper: ALLOWANCE_MODE_INVALID: mode x" } })
    const result = await setAllowance({ userId: U1, targetCredits: 1, actorId: PAYER, mode: "set", note: null })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe("allowance_write_failed")
  })
})

describe("grantAllowance — the additive verb now names its credential too", () => {
  it("passes p_credential_id on every call (387 gave the argument no default)", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: null })
    await grantAllowance({ userId: U1, credits: 10, actorId: PAYER, kind: "topup", note: null, credentialId: KEY })
    expect(rpc).toHaveBeenCalledWith("grant_deployment_allowance", {
      p_user_id: U1,
      p_credits: 10,
      p_actor_id: PAYER,
      p_kind: "topup",
      p_note: null,
      p_credential_id: KEY,
    })
  })

  it("defaults it to null for the page, which has no credential to name", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: null })
    await grantAllowance({ userId: U1, credits: 10, actorId: PAYER, kind: "topup", note: null })
    expect((rpc.mock.calls[0]?.[1] as { p_credential_id: unknown }).p_credential_id).toBeNull()
  })
})

describe("applyPendingAllowance — best effort, and it NEVER throws", () => {
  it("issues no query at all on a deployment with no payer", async () => {
    expect(await applyPendingAllowance(U1, "subject-1", "a@b.test")).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns the count and normalises the identity it was given", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: 2, error: null })
    expect(await applyPendingAllowance(U1, "  subject-1 ", " Mixed@Case.TEST ")).toBe(2)
    expect(rpc).toHaveBeenCalledWith("apply_pending_deployment_allowance", {
      p_user_id: U1,
      p_sso_subject: "subject-1",
      p_email: "mixed@case.test",
    })
  })

  it("swallows a database error, logs it, and answers 0", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } })
    expect(await applyPendingAllowance(U1, "subject-1", "a@b.test")).toBe(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it("swallows a THROWN error too — a sign-in must not 500 over a quota", async () => {
    payerDeployment()
    rpc.mockRejectedValue(new Error("socket hang up"))
    // The assertion is that this resolves at all. An unhandled rejection here
    // propagates into the SSO path, which is the one place a failure turns a
    // working login into a 500.
    await expect(applyPendingAllowance(U1, "subject-1", "a@b.test")).resolves.toBe(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it("treats a null subject and a null email as the absences they are", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: 0, error: null })
    await applyPendingAllowance(U1, null, null)
    expect(rpc).toHaveBeenCalledWith("apply_pending_deployment_allowance", {
      p_user_id: U1,
      p_sso_subject: null,
      p_email: null,
    })
  })
})

describe("resolveUserRef — subject first, email second, uuid accepted", () => {
  it("resolves a subject through the SECURITY DEFINER lookup, never a profiles column", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: U1, error: null })
    expect(await resolveUserRef({ ssoSubject: "subject-1" })).toEqual({ kind: "user", userId: U1 })
    expect(rpc).toHaveBeenCalledWith("find_user_by_sso_subject", { p_subject: "subject-1" })
    expect(from).not.toHaveBeenCalled()
  })

  it("answers absent when the subject names no ONE account", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await resolveUserRef({ ssoSubject: "nobody" })).toEqual({ kind: "absent" })
  })

  it("answers AMBIGUOUS for two profiles sharing an email in different case", async () => {
    payerDeployment()
    profileList = {
      data: [
        { id: U1, email: "person@example.test" },
        { id: U2, email: "Person@Example.TEST" },
      ],
      error: null,
    }
    expect(await resolveUserRef({ email: "PERSON@example.test" })).toEqual({ kind: "ambiguous" })
  })

  it("resolves an email that names exactly one account", async () => {
    payerDeployment()
    profileList = { data: [{ id: U1, email: "Person@Example.TEST" }], error: null }
    expect(await resolveUserRef({ email: " person@example.test " })).toEqual({ kind: "user", userId: U1 })
  })

  it("matches EXACTLY: a row the pattern returned that is not the address is discarded", async () => {
    // Belt for the escaping's braces. Even if a metacharacter survived into
    // the filter, the TypeScript re-check keeps the match exact — so a `%` in
    // an address can never widen a lookup into somebody else's account.
    payerDeployment()
    profileList = { data: [{ id: U2, email: "person+other@example.test" }], error: null }
    expect(await resolveUserRef({ email: "person@example.test" })).toEqual({ kind: "absent" })
  })

  it("never sends a wildcard: the pattern is the escaped address and nothing else", async () => {
    payerDeployment()
    profileList = { data: [], error: null }
    await resolveUserRef({ email: "od%d_y@example.test" })
    const ilike = calls.find((c) => c.op === "ilike")
    expect(ilike?.args[1]).toBe("od\\%d\\_y@example.test")
    expect(String(ilike?.args[1]).replace(/\\./g, "")).not.toMatch(/[%_]/)
  })

  it("refuses an address containing `*` up front, and queries nothing", async () => {
    // PostgREST rewrites `*` to `%` inside an ilike value and no escape
    // survives that rewrite; the TypeScript re-check would keep the ANSWER
    // exact, but `limit(5)` could truncate the true match out of a widened
    // result set and turn a real account into `absent`.
    payerDeployment()
    expect(await resolveUserRef({ email: "per*son@example.test" })).toEqual({ kind: "ambiguous" })
    expect(from).not.toHaveBeenCalled()
  })

  it("a lookup that could not be PERFORMED is ambiguous, never absent", async () => {
    // `sso-linking.ts` takes exactly this posture at its own maybeSingle()
    // error branch: "we cannot tell which account this address names" is never
    // a licence to act on one — and here acting means moving a paid quota.
    payerDeployment()
    profileList = { data: null, error: { message: "connection reset" } }
    expect(await resolveUserRef({ email: "person@example.test" })).toEqual({ kind: "ambiguous" })
  })

  it("accepts a studio uuid, but verifies it exists rather than trusting it", async () => {
    payerDeployment()
    profileRow = { data: { id: U1 }, error: null }
    expect(await resolveUserRef({ id: U1 })).toEqual({ kind: "user", userId: U1 })
    profileRow = { data: null, error: null }
    expect(await resolveUserRef({ id: U2 })).toEqual({ kind: "absent" })
  })

  it("a reference that names nobody is absent, and queries nothing", async () => {
    payerDeployment()
    expect(await resolveUserRef({})).toEqual({ kind: "absent" })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("writePendingAllowance — the intent stored before the account exists", () => {
  it("stores the address lower-cased and clears the unapplied row first", async () => {
    payerDeployment()
    const result = await writePendingAllowance({
      email: " Person@Example.TEST ",
      targetCredits: 700,
      mode: "set",
      note: "bought early",
      createdBy: PAYER,
      credentialId: KEY,
    })
    expect(result).toEqual({ ok: true, id: "pending-1", expiresAt: "2026-12-05T00:00:00.000Z" })
    // The delete comes FIRST: a replayed write replaces the intent rather than
    // queueing a second one, which the partial unique index would refuse.
    const ops = calls.filter((c) => c.table === "deployment_allowance_pending").map((c) => c.op)
    expect(ops.indexOf("delete")).toBeLessThan(ops.indexOf("insert"))
    const inserted = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>
    expect(inserted.email).toBe("person@example.test")
    expect(inserted.sso_subject).toBeNull()
    expect(inserted.target_credits).toBe(700)
    expect(inserted.credential_id).toBe(KEY)
  })

  it("clears BOTH keys when the intent names both — one delete per partial index", async () => {
    // There are TWO partial unique indexes, `(sso_subject)` and
    // `(lower(email))`, each WHERE `applied_at IS NULL`. Clearing only one of
    // them leaves a row the insert then collides with.
    payerDeployment()
    await writePendingAllowance({
      ssoSubject: "subject-1",
      email: "Person@Example.TEST",
      targetCredits: 10,
      mode: "renew",
      note: null,
      createdBy: PAYER,
    })
    const eqs = calls.filter((c) => c.table === "deployment_allowance_pending" && c.op === "eq")
    expect(eqs.map((c) => c.args)).toEqual([
      ["sso_subject", "subject-1"],
      ["email", "person@example.test"],
    ])
  })

  it("an email-only intent then a subject+email intent for the same person does NOT collide", async () => {
    // The sequence the one-key clear got wrong: the first row is keyed by
    // address alone, so a later subject+email write that cleared only by
    // subject would leave it standing and violate the email index — a 500 for
    // an integrator that did nothing wrong.
    payerDeployment()
    await writePendingAllowance({
      email: "person@example.test",
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    calls = []
    const second = await writePendingAllowance({
      ssoSubject: "subject-1",
      email: "PERSON@example.test",
      targetCredits: 20,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(second.ok).toBe(true)
    const cleared = calls.filter((c) => c.op === "eq").map((c) => c.args)
    expect(cleared).toContainEqual(["email", "person@example.test"])
    expect(cleared).toContainEqual(["sso_subject", "subject-1"])
  })

  it("and the reverse order clears the subject row too", async () => {
    payerDeployment()
    await writePendingAllowance({
      ssoSubject: "subject-1",
      email: "person@example.test",
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    calls = []
    const second = await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 20,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(second.ok).toBe(true)
    // Only the subject key this time — there is no address to collide on.
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["sso_subject", "subject-1"]])
  })

  it("clears by SUBJECT alone when no address is given", async () => {
    payerDeployment()
    await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 10,
      mode: "renew",
      note: null,
      createdBy: PAYER,
    })
    const eqOnPending = calls.find((c) => c.table === "deployment_allowance_pending" && c.op === "eq")
    expect(eqOnPending?.args).toEqual(["sso_subject", "subject-1"])
  })

  it("refuses an actor that is not the billing account, and writes nothing", async () => {
    // `created_by` is documented as "always the payer, asserted at write".
    // This is that assertion — a pending row has no RPC behind it to make the
    // one the two verbs make in SQL.
    payerDeployment()
    const result = await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: U1,
    })
    expect(result).toEqual({
      ok: false,
      code: "allowance_actor_not_payer",
      message: "actor is not the billing account",
    })
    expect(calls.some((c) => c.op === "insert" || c.op === "delete")).toBe(false)
  })

  it("refuses when there is no payer at all", async () => {
    const result = await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe("allowance_unconfigured")
  })

  it("expires 90 days out by default", async () => {
    payerDeployment()
    const before = Date.now()
    await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    const inserted = calls.find((c) => c.op === "insert")?.args[0] as { expires_at: string }
    const days = (Date.parse(inserted.expires_at) - before) / 86_400_000
    expect(days).toBeGreaterThan(89.9)
    expect(days).toBeLessThan(90.1)
  })

  it("refuses an intent that names nobody, and one whose target is negative", async () => {
    payerDeployment()
    const nameless = await writePendingAllowance({
      targetCredits: 10,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(nameless.ok).toBe(false)
    const negative = await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: -1,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(negative).toEqual({
      ok: false,
      code: "allowance_target_invalid",
      message: "a pending allowance target must be zero or a positive whole number of credits",
    })
    // Neither wrote anything: an intent the apply would later refuse is a
    // quota that silently never lands.
    expect(calls.some((c) => c.op === "insert")).toBe(false)
  })

  it("accepts a target of ZERO — a cancelled plan is a quota of 0", async () => {
    payerDeployment()
    const result = await writePendingAllowance({
      ssoSubject: "subject-1",
      targetCredits: 0,
      mode: "set",
      note: null,
      createdBy: PAYER,
    })
    expect(result.ok).toBe(true)
  })
})

describe("ssoSubjectsFor", () => {
  it("answers a map of the ids that HAVE a subject, and omits the ones that do not", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: [{ id: U1, sso_subject: "subject-1" }], error: null })
    const map = await ssoSubjectsFor([U1, U2, U1])
    expect(map.get(U1)).toBe("subject-1")
    expect(map.has(U2)).toBe(false)
    expect(rpc).toHaveBeenCalledWith("sso_subjects_for", { p_ids: [U1, U2] })
  })

  it("degrades to an EMPTY map rather than null — losing a decoration must not lose the list", async () => {
    payerDeployment()
    rpc.mockResolvedValue({ data: null, error: { message: "nope" } })
    expect((await ssoSubjectsFor([U1])).size).toBe(0)
  })

  it("queries nothing without a payer, and nothing for an empty list", async () => {
    expect((await ssoSubjectsFor([U1])).size).toBe(0)
    payerDeployment()
    expect((await ssoSubjectsFor([])).size).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })
})
