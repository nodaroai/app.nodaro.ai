import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * Tests assume EDITION=cloud (from `src/test/setup.ts`), so the cloud-only
 * `check_balance` and `credit_transactions` tools register when
 * `credits:read` is granted.
 */

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("../../../../ee/billing/credits.js", () => ({
  STATIC_CREDIT_COSTS: {
    "nano-banana": 2,
    veo3: 79,
    "elevenlabs-v3": 4,
    "combine-videos": 0,
  },
  CreditsService: {
    getBalance: vi.fn().mockResolvedValue({
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
    }),
  },
}))

const { registerModels } = await import("../models.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

describe("list_models tool (always available)", () => {
  it("returns the static catalog reshaped as a list", async () => {
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_models", {})
    expect(result.isError).toBeUndefined()
    // Use a non-hidden image model — nano-banana is now mcpHidden.
    expect(result.content[0]?.text).toContain("\"nano-banana-2\"")
    expect(result.content[0]?.text).toContain("\"image\"")
  })

  it("filters by kind", async () => {
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_models", { kind: "video" })
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("\"veo3\"")
    expect(text).not.toContain("\"nano-banana-2\"")
  })
})

describe("check_balance tool (cloud + credits:read)", () => {
  it("returns the user's credit balance", async () => {
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["credits:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "check_balance", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"total\": 250")
  })

  it("does NOT register without credits:read scope", async () => {
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("check_balance")
  })
})

describe("credit_transactions tool", () => {
  it("returns the user's transaction history", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "tx-1",
                  type: "subscription",
                  amount_usd: 24,
                  credits_granted: 475,
                  tier: "basic",
                  created_at: "2026-04-01T00:00:00Z",
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    })
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["credits:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "credit_transactions", { limit: 10 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"tx-1\"")
  })

  it("does NOT register without credits:read scope", async () => {
    const server = buildServer()
    registerModels({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("credit_transactions")
  })
})
