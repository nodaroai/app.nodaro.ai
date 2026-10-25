/**
 * The Trash over MCP: `read_session removed`, `update_session`'s moves and
 * restores (tools/sessions.ts), and `list_trash` / `restore_job`
 * (tools/trash.ts) — each the REST route of the same thing, under the same
 * scopes (jobs:read to read, assets:write to write).
 */
import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerSessionTools } from "../sessions.js"
import { registerTrashTools, trashLine } from "../trash.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const SESSION = "00000000-0000-4000-8000-000000000020"
const SOURCE = "00000000-0000-4000-8000-000000000021"
const JOB = "00000000-0000-4000-8000-0000000000a1"
const PROJECT = "00000000-0000-4000-8000-000000000010"

type Call = { method: string; url: string; body: unknown }

function setup(scopes: Scope[] = ["jobs:read", "assets:write"]) {
  const calls: Call[] = []
  const fastify = Fastify()
  const record = (method: string, answer: unknown) => async (req: { url: string; body: unknown }) => {
    calls.push({ method, url: req.url, body: req.body })
    return answer
  }
  fastify.get("/v1/sessions/:id/items", record("GET", { data: [], next: null }))
  fastify.post("/v1/sessions/:id/items/move", record("POST", { data: { moved: 1 } }))
  fastify.post("/v1/sessions/:id/items/:jobId/restore", record("POST", { success: true }))
  fastify.delete("/v1/sessions/:id/items/:jobId", record("DELETE", { success: true }))
  fastify.get("/v1/trash", record("GET", { data: [], next: null }))
  fastify.post("/v1/jobs/:id/restore", record("POST", { success: true }))
  const server = buildServer()
  const session = newSession({ userId: "u1", scopes, clientName: "Claude" })
  registerSessionTools({ server, session, fastify })
  registerTrashTools({ server, session, fastify })
  return { server, calls, session }
}

const textOf = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? ""

describe("read_session", () => {
  it("removed: true reads the session's Trash", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "read_session", { session_id: SESSION, removed: true })
    expect(calls[0]?.url).toBe(`/v1/sessions/${SESSION}/items?removed=true`)
    expect(textOf(result)).toBe("Nothing was removed from the session.")
  })
})

describe("update_session", () => {
  it("moves items in from another session", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "update_session", { session_id: SESSION, move_job_ids: [JOB], from_session_id: SOURCE })
    expect(result.isError).toBeUndefined()
    expect(calls).toEqual([{ method: "POST", url: `/v1/sessions/${SESSION}/items/move`, body: { jobIds: [JOB], fromSessionId: SOURCE } }])
  })

  it("refuses move_job_ids without from_session_id, and the reverse, changing nothing", async () => {
    const { server, calls } = setup()
    expect((await callTool(server, "update_session", { session_id: SESSION, move_job_ids: [JOB] })).isError).toBe(true)
    expect((await callTool(server, "update_session", { session_id: SESSION, from_session_id: SOURCE })).isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("restores removed items, and says a removal goes to the Trash", async () => {
    const { server, calls } = setup()
    await callTool(server, "update_session", { session_id: SESSION, restore_job_ids: [JOB] })
    expect(calls).toEqual([{ method: "POST", url: `/v1/sessions/${SESSION}/items/${JOB}/restore`, body: undefined }])
    const removed = await callTool(server, "update_session", { session_id: SESSION, remove_job_ids: [JOB] })
    expect(textOf(removed)).toContain("Trash")
  })
})

describe("list_trash", () => {
  it("reads GET /v1/trash with the scope", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "list_trash", { project: PROJECT, tool: "create-image", types: ["generate-image", "edit-image"] })
    const url = new URL(`http://x${calls[0]!.url}`)
    expect(url.pathname).toBe("/v1/trash")
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: PROJECT, tool: "create-image", type: "generate-image,edit-image" })
    expect(textOf(result)).toBe("The Trash is empty.")
  })

  it("an in-app session pinned to a project reads that project's Trash, whatever it asks", async () => {
    const { server, calls, session } = setup()
    session.scopedProjectId = PROJECT
    await callTool(server, "list_trash", { project: "none" })
    expect(new URL(`http://x${calls[0]!.url}`).searchParams.get("projectId")).toBe(PROJECT)
  })

  it("says how each kind comes back", () => {
    const job = { id: JOB, job_type: "generate-image", input_data: { prompt: "a cat" } }
    expect(trashLine({ kind: "removed", removedAt: "2026-10-25T10:00:00Z", session: { id: SESSION, title: "Beach" }, job }))
      .toContain("update_session restore_job_ids")
    expect(trashLine({ kind: "deleted", deletedAt: "2026-10-25T10:00:00Z", purgeAt: "2026-11-24T10:00:00Z", job }))
      .toContain("restore_job")
  })
})

describe("restore_job", () => {
  it("posts the restore", async () => {
    const { server, calls } = setup()
    const result = await callTool(server, "restore_job", { job_id: JOB })
    expect(result.isError).toBeUndefined()
    expect(calls).toEqual([{ method: "POST", url: `/v1/jobs/${JOB}/restore`, body: undefined }])
  })
})

describe("the scopes", () => {
  it("jobs:read alone lists the Trash but cannot restore", async () => {
    const { server } = setup(["jobs:read"])
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("list_trash")
    expect(names).not.toContain("restore_job")
  })
})
