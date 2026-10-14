/**
 * MCP `continue_use_case` through the REAL continue route (decided
 * 2026-10-14). An MCP verb is injected on the internal lane, where a resumed
 * review-on run is refused unless a reviewer is forwarded; the agent
 * continuing its own run is that run's reviewer, so the verb forwards one.
 */
import { m, USER, ID, makeApp } from "./helpers/use-case-continue-harness.js"
import { describe, it, expect } from "vitest"

async function mcpServer() {
  const app = await makeApp()
  const { registerUseCaseVerbs } = await import("@/lib/mcp/tools/verbs-use-case.js")
  const { buildServer } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
  const { newSession } = await import("@/lib/mcp/session.js")
  const server = buildServer()
  registerUseCaseVerbs({ server, session: newSession({ userId: USER, scopes: ["workflows:execute"] as never, clientName: "Claude" }), fastify: app })
  return server
}

describe("MCP continue_use_case through the real route", () => {
  it("a from-failed continue of a review-on run starts, its hidden run told a reviewer is present (no 409)", async () => {
    // What mcpInject's orchestrator secret makes of the request (auth.ts): the internal lane.
    m.authKind = "internal"
    const { callTool } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
    const res = await callTool(await mcpServer(), "continue_use_case", { job_id: ID, mode: "from-failed" })
    expect(JSON.stringify(res.content)).not.toMatch(/preview_review_required/)
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true })
  })
})
