/**
 * The money gate for a customer-federated deployment.
 *
 * The property under test is not "does the allowlist work" — it is "can the
 * party that controls the identity provider reach the money routes". Every
 * case below is one way they might try: an admin they minted, an admin whose
 * email they chose, a federated account carrying an allowlisted address, a
 * host with no operator configured at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => ({
  isAdmin: vi.fn(async () => true),
  getUserById: vi.fn(
    async (_id: string): Promise<{ data: { user: Record<string, unknown> } | null; error: { message: string } | null }> => ({
      data: { user: { id: "u-1", email: "owner@nodaro.ai", app_metadata: {} } },
      error: null,
    }),
  ),
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: h.isAdmin }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { auth: { admin: { getUserById: h.getUserById } } },
}))

const { requirePlatformOperator, platformOperatorEmails } = await import("../require-platform-operator.js")
const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import(
  "../../../lib/deployment-payer.js"
)

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  const reply = {
    sent,
    status(code: number) {
      return { send: (body: unknown) => { sent.push({ status: code, body }); return reply } }
    },
  }
  return reply
}
const req = (over: Record<string, unknown> = {}) => ({ userId: "u-1", url: "/v1/admin/users/x/credits", ...over })

const ENV_KEYS = ["PLATFORM_OPERATOR_EMAILS", "PLATFORM_OWNER_EMAIL"] as const
const REAL_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV_KEYS) REAL_ENV[k] = process.env[k]
  h.isAdmin.mockResolvedValue(true)
  h.getUserById.mockResolvedValue({
    data: { user: { id: "u-1", email: "owner@nodaro.ai", app_metadata: {} } },
    error: null,
  })
  process.env.PLATFORM_OPERATOR_EMAILS = ""
  process.env.PLATFORM_OWNER_EMAIL = "owner@nodaro.ai"
})
afterEach(() => {
  __resetDeploymentPayerForTests()
  for (const k of ENV_KEYS) {
    if (REAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = REAL_ENV[k] as string
  }
})

describe("inert without a deployment payer (mainline must not change)", () => {
  it("an admin passes, and the account is never even read", async () => {
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent).toHaveLength(0)
    // The whole operator apparatus — allowlist, account read — stays asleep.
    expect(h.getUserById).not.toHaveBeenCalled()
  })

  it("a non-admin gets the ordinary 403, byte-identical to requireAdmin", async () => {
    h.isAdmin.mockResolvedValue(false)
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent[0]).toEqual({
      status: 403,
      body: { error: { code: "forbidden", message: "Admin access required" } },
    })
  })

  it("an allowlist that names nobody is irrelevant off-payer — the admin still passes", async () => {
    process.env.PLATFORM_OWNER_EMAIL = ""
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent).toHaveLength(0)
  })
})

describe("with a deployment payer active", () => {
  beforeEach(() => __setDeploymentPayerForTests("payer-acct"))

  it("the configured operator passes", async () => {
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent).toHaveLength(0)
  })

  it("AN ADMIN THE CUSTOMER MINTED is refused — role is not authority here", async () => {
    h.getUserById.mockResolvedValue({
      data: { user: { id: "u-1", email: "their-admin@acme.example", app_metadata: {} } },
      error: null,
    })
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent[0]?.status).toBe(403)
    expect((reply.sent[0]?.body as { error: { code: string } }).error.code).toBe("operator_required")
  })

  it("A FEDERATED ACCOUNT CARRYING AN ALLOWLISTED EMAIL is refused — the IdP picks emails", async () => {
    // The attack the second condition exists for: the customer asserts the
    // operator's own address through their IdP. Same email, still refused.
    h.getUserById.mockResolvedValue({
      data: { user: { id: "u-1", email: "owner@nodaro.ai", app_metadata: { sso: "sai" } } },
      error: null,
    })
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent[0]?.status).toBe(403)
    expect((reply.sent[0]?.body as { error: { code: string } }).error.code).toBe("operator_required")
  })

  it("a forged user_metadata.sso marker does NOT flip the verdict (app_metadata is authoritative)", async () => {
    h.getUserById.mockResolvedValue({
      data: { user: { id: "u-1", email: "owner@nodaro.ai", app_metadata: {}, user_metadata: { sso: "sai" } } },
      error: null,
    })
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent).toHaveLength(0)
  })

  it("no operator configured ⇒ NOBODY may mint (fail closed)", async () => {
    process.env.PLATFORM_OWNER_EMAIL = ""
    process.env.PLATFORM_OPERATOR_EMAILS = ""
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent[0]?.status).toBe(403)
    expect(h.getUserById).not.toHaveBeenCalled()
  })

  it("an unreadable account fails closed, not open", async () => {
    h.getUserById.mockResolvedValue({ data: null, error: { message: "network" } })
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(reply.sent[0]?.status).toBe(403)
  })

  it("a non-admin is refused before the operator policy is consulted", async () => {
    h.isAdmin.mockResolvedValue(false)
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect((reply.sent[0]?.body as { error: { code: string } }).error.code).toBe("forbidden")
    expect(h.getUserById).not.toHaveBeenCalled()
  })

  it("unauthenticated is 401", async () => {
    const reply = makeReply()
    await requirePlatformOperator(req({ userId: undefined }) as never, reply as never)
    expect(reply.sent[0]?.status).toBe(401)
  })

  it("the refusal body never discloses who IS allowed", async () => {
    h.getUserById.mockResolvedValue({
      data: { user: { id: "u-1", email: "their-admin@acme.example", app_metadata: {} } },
      error: null,
    })
    const reply = makeReply()
    await requirePlatformOperator(req() as never, reply as never)
    expect(JSON.stringify(reply.sent[0]?.body)).not.toContain("owner@nodaro.ai")
  })
})

describe("platformOperatorEmails", () => {
  it("PLATFORM_OPERATOR_EMAILS wins, is comma-split, trimmed and lower-cased", () => {
    process.env.PLATFORM_OPERATOR_EMAILS = " A@x.com , b@Y.com ,, "
    expect([...platformOperatorEmails()].sort()).toEqual(["a@x.com", "b@y.com"])
  })

  it("falls back to the single PLATFORM_OWNER_EMAIL when unset", () => {
    process.env.PLATFORM_OPERATOR_EMAILS = ""
    process.env.PLATFORM_OWNER_EMAIL = "Owner@Nodaro.ai"
    expect([...platformOperatorEmails()]).toEqual(["owner@nodaro.ai"])
  })

  it("both unset ⇒ empty set (the fail-closed input)", () => {
    process.env.PLATFORM_OPERATOR_EMAILS = ""
    process.env.PLATFORM_OWNER_EMAIL = ""
    expect(platformOperatorEmails().size).toBe(0)
  })
})
