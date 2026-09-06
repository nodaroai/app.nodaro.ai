/**
 * `/mcp` must never mint a first-party session.
 *
 * The carve-out that lets the deployment payer's own in-app Copilot read the
 * pool balance is keyed on a SERVER-SET flag (`McpSession.firstParty`), set
 * only where the server builds a session for a browser (JWT) user in-process.
 * `/mcp` is the public door: its `clientName` is `developer_apps.name`, chosen
 * by the third-party developer being guarded against, and its bearer may be
 * any token the payer account consented to. So the route sets nothing and the
 * default refuses.
 *
 * Proven END TO END rather than by reading the route: the real
 * `buildMcpServer` runs, the real session is built, and the real
 * `check_balance` handler answers — the route's opts are captured on the way
 * through only to state the "never sets it" half in one line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
})

const PAYER_ID = "00000000-0000-4000-8000-0000000009e1"
const REFUSAL =
  "Error: payer_balance_jwt_only — the deployment balance is available to the billing account's own session only."

// `resolveClientName` reads `developer_apps`; the credits tools' own reads must
// not reach a real client. One self-returning chain serves both.
vi.mock("../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "lt", "limit"]) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: { name: "Some Client" }, error: null }))
  return { supabase: { from: vi.fn(() => chain) } }
})

/** What the route asked `buildMcpServer` for — the only thing this file mocks about it. */
const built = vi.hoisted(() => ({ opts: null as Record<string, unknown> | null }))
vi.mock("../../lib/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/mcp/server.js")>()
  return {
    ...actual,
    buildMcpServer: async (opts: Parameters<typeof actual.buildMcpServer>[0]) => {
      built.opts = opts as unknown as Record<string, unknown>
      return actual.buildMcpServer(opts)
    },
  }
})

/** The JSON-RPC transport is not what this test is about. */
const handled = vi.hoisted(() => ({ server: null as unknown }))
vi.mock("../../lib/mcp/fastify-adapter.js", () => ({
  handleMcpRequest: async (server: unknown, _req: unknown, reply: { send: (b: unknown) => void }) => {
    handled.server = server
    reply.send({ ok: true })
  },
}))

const { registerMcpRoute } = await import("../mcp.js")
const { callTool } = await import("../../lib/mcp/tools/__tests__/_helpers.js")
const { CreditsService } = await import("../../ee/billing/credits.js")
const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import(
  "../../lib/deployment-payer.js"
)

const getBalance = vi.spyOn(CreditsService, "getBalance")

/** The payer's own `ndr_app_` token: their identity, `credits:read` consented. */
async function appWithPayerToken(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = PAYER_ID
    ;(req as { appAuthorization?: unknown }).appAuthorization = {
      appId: "00000000-0000-4000-8000-00000000a001",
      scopes: ["credits:read"],
    }
  })
  await registerMcpRoute(app)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetDeploymentPayerForTests()
  getBalance.mockResolvedValue({ total: 250 } as never)
})

afterEach(() => {
  __resetDeploymentPayerForTests()
  built.opts = null
  handled.server = null
})

describe("/mcp under a deployment payer", () => {
  it("never sets firstParty, so the payer's own token session is still refused check_balance", async () => {
    __setDeploymentPayerForTests(PAYER_ID)
    const app = await appWithPayerToken()

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", method: "initialize", id: 1 },
    })
    expect(res.statusCode).toBe(200)

    // The route's own opts: the flag is absent, not false-by-accident.
    expect(built.opts).not.toBeNull()
    expect(Object.hasOwn(built.opts!, "firstParty")).toBe(false)

    // …and the session it produced refuses, which is the property that matters.
    const result = await callTool(handled.server as never, "check_balance", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(REFUSAL)
    expect(getBalance).not.toHaveBeenCalled()

    await app.close()
  })

  it("R2 — with no payer configured the same session answers unchanged", async () => {
    const app = await appWithPayerToken()
    await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", method: "initialize", id: 1 } })

    const result = await callTool(handled.server as never, "check_balance", {})
    expect(result.isError).toBeUndefined()
    expect(getBalance).toHaveBeenCalledWith(PAYER_ID)

    await app.close()
  })
})
