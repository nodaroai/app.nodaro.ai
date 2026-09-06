import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import type { Scope } from "../../scopes.js"

/**
 * The MCP balance leak: on a deployment that funds its users from one
 * account, that account's own pool figure — the operator's remaining money —
 * must not be readable by any programmatic caller.
 *
 * The REST balance routes already refuse the deployment payer's real pool
 * figure to any programmatic credential (`refusePayerBalanceToProgrammaticCaller`,
 * `ee/lib/payer-balance-guard.ts`). MCP was the door left open: `/mcp` accepts
 * `ndr_app_` bearers, the self-host Connect token is minted with `credits:read`
 * AND is owned by the billing account, so `check_balance` / `credit_transactions`
 * answered the operator's wallet to whoever holds that token.
 *
 * The tool-side rule is IDENTITY ALONE, and it refuses more than the REST
 * guard does. Not every MCP session is a token session: `/mcp` takes its
 * scopes from `req.appAuthorization` (`routes/mcp.ts:73`), so a browser JWT
 * arrives with `[]` and these tools never register — but the Workflow Copilot
 * builds an in-process server for the BROWSER user (`ee/copilot/turn-runner.ts:96`)
 * whose `COPILOT_SCOPES` include `credits:read`, with `check_balance` on its
 * allowlist. So the billing account's own Copilot is refused too. That
 * narrowing is deliberate; a carve-out would need a server-set first-party
 * flag on the session, never the client name.
 *
 * THE PAYER PREDICATES ARE DRIVEN FOR REAL (`__setDeploymentPayerForTests`),
 * never mocked: a mocked `deploymentPayerActive` would pass whether or not the
 * handler actually consults it. Same discipline as
 * `ee/routes/__tests__/admin-users-payer-redaction.test.ts`.
 */

const PAYER_ID = "00000000-0000-4000-8000-0000000009e1"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000001"

const REFUSAL =
  "Error: payer_balance_jwt_only — the deployment balance is available to the billing account's own session only."

// Registration-time codepaths in the full catalog may touch the client; the
// `credit_transactions` body definitely does. One self-returning chain serves
// both (the fluent shape survives wiring changes a nested mock would break).
vi.mock("../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { buildMcpServer } = await import("../server.js")
const { newSession } = await import("../session.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { supabase } = await import("../../supabase.js")
const { CreditsService } = await import("../../../ee/billing/credits.js")
const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import(
  "../../deployment-payer.js"
)

const BALANCE = {
  total: 250,
  subscription: 200,
  topup: 50,
  dailySpent: 12,
  dailyLimit: 50,
  monthlyAllocation: 250,
  tier: "free",
  features: {},
  periodEnd: null,
  appCreditsAllowance: 0,
}

const TRANSACTION = {
  id: "tx-1",
  stripe_transaction_id: "pi_1",
  type: "subscription",
  amount_usd: 24,
  credits_granted: 475,
  tier: "basic",
  created_at: "2026-04-01T00:00:00Z",
  receipt_url: null,
}

// Module-scope spy: `vi.clearAllMocks()` clears CALLS but keeps the
// implementation, so the real `getBalance` never runs against the stub client.
const getBalance = vi.spyOn(CreditsService, "getBalance")

function stubTransactions(): void {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "lt"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockResolvedValue({ data: [TRANSACTION], error: null })
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
}

async function serverFor(userId: string, opts: { firstParty?: boolean } = {}) {
  return buildMcpServer({
    userId,
    scopes: ["credits:read"] as Scope[],
    clientName: "Claude",
    fastify: Fastify(),
    ...opts,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetDeploymentPayerForTests()
  getBalance.mockResolvedValue(BALANCE as never)
  stubTransactions()
})

afterEach(() => {
  // The payer module is a singleton shared with `tools/models.ts` — leaving it
  // active would make the mainline case below assert nothing.
  __resetDeploymentPayerForTests()
})

describe("MCP credits tools under a deployment payer", () => {
  it("refuses check_balance and credit_transactions to the payer's own session", async () => {
    __setDeploymentPayerForTests(PAYER_ID)
    const server = await serverFor(PAYER_ID)

    const balance = await callTool(server, "check_balance", {})
    expect(balance.isError).toBe(true)
    expect(balance.content[0]?.text).toBe(REFUSAL)
    // Refused BEFORE the read — the pool figure is never fetched, so it cannot
    // leak through a later cache or an error message either.
    expect(getBalance).not.toHaveBeenCalled()

    const transactions = await callTool(server, "credit_transactions", { limit: 10 })
    expect(transactions.isError).toBe(true)
    expect(transactions.content[0]?.text).toBe(REFUSAL)
    // Named table, not a bare `not.toHaveBeenCalled()`: registration-time
    // codepaths in the full catalog may legitimately touch the client (see the
    // mock note above), so the assertion has to be about the READ that must
    // not happen, not about the client being untouched.
    expect(supabase.from).not.toHaveBeenCalledWith("transactions")
  })

  it("answers an ordinary user on the same payer instance normally", async () => {
    __setDeploymentPayerForTests(PAYER_ID)
    const server = await serverFor(OTHER_USER_ID)

    const balance = await callTool(server, "check_balance", {})
    expect(balance.isError).toBeUndefined()
    expect(balance.content[0]?.text).toContain("\"total\": 250")
    expect(getBalance).toHaveBeenCalledWith(OTHER_USER_ID)

    const transactions = await callTool(server, "credit_transactions", { limit: 10 })
    expect(transactions.isError).toBeUndefined()
    expect(transactions.content[0]?.text).toContain("\"tx-1\"")
  })

  it("answers the payer's own FIRST-PARTY session — the in-app Copilot — normally", async () => {
    // The carve-out. A session the server built for a BROWSER (JWT) user
    // in-process reads the pool figure exactly as that account's own billing
    // page does; the REST guard allows the same caller for the same reason.
    __setDeploymentPayerForTests(PAYER_ID)
    const server = await serverFor(PAYER_ID, { firstParty: true })

    const balance = await callTool(server, "check_balance", {})
    expect(balance.isError).toBeUndefined()
    expect(balance.content[0]?.text).toContain("\"total\": 250")
    expect(getBalance).toHaveBeenCalledWith(PAYER_ID)

    const transactions = await callTool(server, "credit_transactions", { limit: 10 })
    expect(transactions.isError).toBeUndefined()
    expect(transactions.content[0]?.text).toContain("\"tx-1\"")
  })

  it("still refuses the payer when the flag is explicitly false", async () => {
    __setDeploymentPayerForTests(PAYER_ID)
    const server = await serverFor(PAYER_ID, { firstParty: false })

    const balance = await callTool(server, "check_balance", {})
    expect(balance.isError).toBe(true)
    expect(balance.content[0]?.text).toBe(REFUSAL)
    expect(getBalance).not.toHaveBeenCalled()

    const transactions = await callTool(server, "credit_transactions", { limit: 10 })
    expect(transactions.isError).toBe(true)
    expect(transactions.content[0]?.text).toBe(REFUSAL)
    expect(supabase.from).not.toHaveBeenCalledWith("transactions")
  })

  it("the flag is SERVER-SET: a session built without the option is not first-party", async () => {
    // Nothing a client sends can reach it — not a tool input, not the client
    // name, not a header. The only way in is the `firstParty` build option,
    // and its absence is the refusing value.
    const session = newSession({ userId: PAYER_ID, scopes: ["credits:read"] as Scope[], clientName: "Claude" })
    expect(session.firstParty).toBe(false)
  })

  it("mainline (no payer configured): answers the same user unchanged", async () => {
    // No __setDeploymentPayerForTests: `deploymentPayerActive()` is false, so
    // the guard short-circuits and this id is just another user.
    const server = await serverFor(PAYER_ID)

    const balance = await callTool(server, "check_balance", {})
    expect(balance.isError).toBeUndefined()
    expect(balance.content[0]?.text).toContain("\"total\": 250")
    expect(getBalance).toHaveBeenCalledWith(PAYER_ID)

    const transactions = await callTool(server, "credit_transactions", { limit: 10 })
    expect(transactions.isError).toBeUndefined()
    expect(transactions.content[0]?.text).toContain("\"tx-1\"")
  })
})
