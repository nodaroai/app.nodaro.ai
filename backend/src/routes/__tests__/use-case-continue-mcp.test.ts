/**
 * MCP `continue_use_case` through the REAL continue route (decided
 * 2026-10-14). An MCP verb is injected on the internal lane, where a resumed
 * review-on run is refused unless a reviewer is forwarded; the agent
 * continuing its own run is that run's reviewer, so the verb forwards one.
 */
import { m, src, USER, ID, makeApp, p1StoredRun } from "./helpers/use-case-continue-harness.js"
import { describe, it, expect } from "vitest"

async function mcpServer() {
  // The verb reads the run's type from its job first: the owner's read of the
  // harness's wrapper row, as GET /v1/jobs/:id answers it (job_type and input_data).
  const app = await makeApp((a) =>
    a.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
      const row = src.wrapper
      if (!row || row.id !== req.params.id || row.user_id !== req.userId) return reply.code(404).send({ error: { code: "not_found", message: "Job not found" } })
      return { data: { id: row.id, job_type: row.job_type ?? null, input_data: row.input_data } }
    }),
  )
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

  it("a run P1 stored with its type only on job_type is continued on the Tighten Episode route", async () => {
    m.authKind = "internal"
    p1StoredRun("failed", { typeOn: "job_type" })
    const { callTool } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
    const res = await callTool(await mcpServer(), "continue_use_case", { job_id: ID, mode: "from-failed" })
    expect(res.isError).toBeFalsy()
    expect(m.execute).toHaveBeenCalledTimes(1)
  })
})
