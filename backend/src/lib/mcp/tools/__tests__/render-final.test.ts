/**
 * MCP `render_final` (decided 2026-10-06): an agent's Render final. The server
 * derives the run set; the tool quotes first (no `confirm`: the quote route,
 * nothing created) and runs only with `confirm: true`, as `start_recast` does.
 * A refusal — a 402 among them — comes back as a tool error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession, type McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { registerRenderFinal } = await import("../render-final.js")
const { supabase } = await import("../../../supabase.js")
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"
const EXECUTION_ID = "00000000-0000-4000-8000-000000000061"

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) obj[m] = vi.fn(() => obj)
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  return obj
}

function mcpSession(scopes: Scope[]): McpSession {
  const s = newSession({ userId: "u1", scopes, clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

function stub(opts: { quoteStatus?: number; quoteBody?: object; runStatus?: number; runBody?: object } = {}) {
  const fastify = Fastify()
  const seen: { quote?: Record<string, unknown>; run?: Record<string, unknown>; runKey?: unknown; runs: number } = { runs: 0 }
  fastify.post("/v1/workflows/:id/render-final/estimate", async (req, reply) => {
    seen.quote = req.body as Record<string, unknown>
    return reply.status(opts.quoteStatus ?? 200).send(
      opts.quoteBody ?? { data: { renderNodeId: "cut", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } }, estimatedCredits: 530 } },
    )
  })
  fastify.post("/v1/workflows/:id/run", async (req, reply) => {
    seen.runs += 1
    seen.run = req.body as Record<string, unknown>
    seen.runKey = req.headers["idempotency-key"]
    return reply.status(opts.runStatus ?? 202).send(opts.runBody ?? { executionId: "e-2", status: "pending" })
  })
  fromMock.mockReturnValue(chain({ data: { name: "Tighten", project_id: MCP_PROJECT_ID }, error: null }))
  const server = buildServer()
  registerRenderFinal({ server, session: mcpSession(["workflows:execute"]), fastify })
  return { server, seen }
}

const args = { workflow_id: WORKFLOW_ID, render_node_id: "cut", execution_id: EXECUTION_ID }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("render_final", () => {
  it("without confirm it quotes, and runs nothing", async () => {
    const { server, seen } = stub()
    const result = await callTool(server, "render_final", args)
    expect(result.isError).toBeUndefined()
    expect(seen.runs).toBe(0)
    expect(seen.quote).toMatchObject({ userId: "u1", renderNodeId: "cut", continueFromExecutionId: EXECUTION_ID })
    expect(result.structuredContent).toMatchObject({ nodeIds: ["cut", "cap"], estimatedCredits: 530, confirmed: false })
    expect(result.content[0]?.text).toContain("530 credits")
    expect(result.content[0]?.text).toContain("confirm: true")
  })

  it("without confirm it says upfront when the payer cannot cover the quote", async () => {
    const { server, seen } = stub({
      quoteBody: {
        data: { renderNodeId: "cut", nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } }, estimatedCredits: 530, sufficient: false, available: 50 },
      },
    })
    const result = await callTool(server, "render_final", args)
    expect(result.isError).toBeUndefined()
    expect(seen.runs).toBe(0)
    expect(result.structuredContent).toMatchObject({ estimatedCredits: 530, sufficient: false, available: 50, confirmed: false })
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("530 credits")
    expect(text).toContain("cannot cover")
    expect(text).toContain("50 available")
    expect(text).not.toContain("confirm: true once they accept")
  })

  it("with confirm it runs the server's Render final as the caller, continuing the execution", async () => {
    const { server, seen } = stub()
    const result = await callTool(server, "render_final", { ...args, confirm: true, client_request_id: "retry-7f3a9c" })
    expect(result.isError).toBeUndefined()
    expect(seen.run).toEqual({
      mcp_client: "Claude",
      userId: "u1",
      renderFinal: { renderNodeId: "cut" },
      continueFromExecutionId: EXECUTION_ID,
    })
    expect(seen.runKey).toBe("mcp:retry-7f3a9c")
    expect(result.structuredContent).toMatchObject({ executionId: "e-2", confirmed: true })
    expect(result.content[0]?.text).toContain("get_app_run")
  })

  it("a refused quote is a tool error, and nothing runs", async () => {
    const { server, seen } = stub({
      quoteStatus: 409,
      quoteBody: { error: { code: "continuation_not_completed", message: "The execution to continue from has not completed." } },
    })
    const result = await callTool(server, "render_final", { ...args, confirm: true })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("continuation_not_completed")
    expect(seen.runs).toBe(0)
  })

  it("a 402 from the run (the route's balance check, before any execution exists) reads as insufficient credits", async () => {
    const { server } = stub({
      runStatus: 402,
      runBody: { error: { code: "insufficient_credits", message: "Insufficient credits. Required: 530, Available: 50", required: 530, available: 50 } },
    })
    const result = await callTool(server, "render_final", { ...args, confirm: true })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("insufficient credits")
  })

  it("a workflow outside the mcp project is not found, and nothing is quoted", async () => {
    const { server, seen } = stub()
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const result = await callTool(server, "render_final", args)
    expect(result.isError).toBe(true)
    expect(seen.quote).toBeUndefined()
  })

  it("is gated by workflows:execute", async () => {
    const server = buildServer()
    registerRenderFinal({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    expect((await listTools(server)).map((t) => t.name)).not.toContain("render_final")
  })
})
