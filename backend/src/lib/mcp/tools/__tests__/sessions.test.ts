/**
 * MCP `update_session` (tools/sessions.ts): the cover goes to PATCH
 * /v1/sessions/:id as `coverJobId`, and an import in the same call runs first,
 * so the cover may be an item that call brings in.
 */
import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerSessionTools } from "../sessions.js"
import { buildServer, callTool } from "./_helpers.js"

const SESSION = "00000000-0000-4000-8000-000000000020"
const JOB = "00000000-0000-4000-8000-0000000000a1"

function setup() {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  const fastify = Fastify()
  const record = (method: string) => async (req: { url: string; body: unknown }) => {
    calls.push({ method, url: req.url, body: req.body })
    return method === "POST" ? { data: { imported: 1, requested: 1 } } : { data: {} }
  }
  fastify.patch("/v1/sessions/:id", record("PATCH"))
  fastify.post("/v1/sessions/:id/items", record("POST"))
  const server = buildServer()
  const session = newSession({ userId: "u1", scopes: ["jobs:read", "assets:write"] as Scope[], clientName: "Claude" })
  registerSessionTools({ server, session, fastify })
  return { server, calls }
}

describe("update_session cover", () => {
  it("sends the cover as coverJobId", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "update_session", { session_id: SESSION, cover_job_id: JOB })
    expect(result.isError).toBeUndefined()
    expect(calls).toEqual([{ method: "PATCH", url: `/v1/sessions/${SESSION}`, body: { coverJobId: JOB } }])
  })

  it("sends null to go back to automatic", async () => {
    const { server, calls } = setup()
    await callTool(server, "update_session", { session_id: SESSION, cover_job_id: null })
    expect(calls[0]?.body).toEqual({ coverJobId: null })
  })

  it("refuses a cover that the same call removes, and changes nothing", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "update_session", { session_id: SESSION, cover_job_id: JOB, remove_job_ids: [JOB] })
    expect(result.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("imports before it sets the cover", async () => {
    const { server, calls } = setup()
    await callTool(server, "update_session", { session_id: SESSION, import_job_ids: [JOB], cover_job_id: JOB })
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"])
  })
})
