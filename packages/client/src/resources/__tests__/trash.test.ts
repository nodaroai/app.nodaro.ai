/**
 * The Trash in the SDK: `client.trash.list`, the sessions' `removeItem` /
 * `restoreItem` / `moveItems` / `items({ removed })`, and the jobs'
 * `delete({ forever })` / `restore` / `list({ projectId, inSession,
 * withSessions })` — each the exact request its route takes.
 */
import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"
import type { TrashEntry, TrashPage } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

function client(body: unknown = { success: true }) {
  const fetchMock = vi.fn().mockImplementation(() => mockOk(body))
  const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
  const call = (i = 0) => ({ url: new URL(fetchMock.mock.calls[i][0] as string), init: fetchMock.mock.calls[i][1] as RequestInit })
  return { c, fetchMock, call }
}

describe("client.trash", () => {
  it("list GETs /v1/trash with the scope, several types comma-separated", async () => {
    const page: TrashPage = { data: [], next: null }
    const { c, call } = client(page)
    expect(await c.trash.list({ projectId: "none", tool: "create-image", type: ["generate-image", "edit-image"], limit: 10, cursor: "abc" })).toEqual(page)
    const { url, init } = call()
    expect(url.pathname).toBe("/v1/trash")
    expect(init.method).toBe("GET")
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: "none", tool: "create-image", type: "generate-image,edit-image", limit: "10", cursor: "abc" })
  })

  it("an entry narrows on kind", () => {
    const entry = { kind: "deleted", deletedAt: "a", purgeAt: "b", job: {} } as unknown as TrashEntry
    if (entry.kind === "deleted") expect(entry.purgeAt).toBe("b")
  })
})

describe("client.sessions and the Trash", () => {
  it("removeItem goes to the Trash; { forever } deletes for good", async () => {
    const { c, call } = client()
    await c.sessions.removeItem("s1", "j1")
    expect(call(0).url.href).toBe("https://api.example.com/v1/sessions/s1/items/j1")
    expect(call(0).init.method).toBe("DELETE")
    await c.sessions.removeItem("s1", "j1", { forever: true })
    expect(call(1).url.search).toBe("?forever=true")
  })

  it("restoreItem POSTs …/restore", async () => {
    const { c, call } = client()
    await c.sessions.restoreItem("s1", "j1")
    expect(call().url.pathname).toBe("/v1/sessions/s1/items/j1/restore")
    expect(call().init.method).toBe("POST")
  })

  it("moveItems POSTs the ids and the source to the target", async () => {
    const { c, call } = client({ data: { moved: 2 } })
    expect(await c.sessions.moveItems("s2", { jobIds: ["j1", "j2"], fromSessionId: "s1" })).toEqual({ data: { moved: 2 } })
    expect(call().url.pathname).toBe("/v1/sessions/s2/items/move")
    expect(JSON.parse(call().init.body as string)).toEqual({ jobIds: ["j1", "j2"], fromSessionId: "s1" })
  })

  it("items({ removed: true }) reads the session's Trash", async () => {
    const { c, call } = client({ data: [], next: null })
    await c.sessions.items("s1", { removed: true })
    expect(call().url.search).toBe("?removed=true")
  })

  it("list({ projectId: 'none' }) lists the sessions with no project", async () => {
    const { c, call } = client({ data: [], next: null })
    await c.sessions.list({ projectId: "none" })
    expect(call().url.searchParams.get("projectId")).toBe("none")
  })
})

describe("client.jobs and the Trash", () => {
  it("delete goes to the Trash; { forever } deletes for good", async () => {
    const { c, call } = client()
    await c.jobs.delete("j1")
    expect(call(0).url.href).toBe("https://api.example.com/v1/jobs/j1")
    await c.jobs.delete("j1", { forever: true })
    expect(call(1).url.search).toBe("?forever=true")
  })

  it("delete forever on a live job is a 409 NodaroError not_in_trash", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(409, { error: { code: "not_in_trash", message: "Delete the job (to the Trash) first." } }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    const err = await c.jobs.delete("j1", { forever: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("not_in_trash")
  })

  it("restore POSTs /v1/jobs/:id/restore", async () => {
    const { c, call } = client()
    await c.jobs.restore("j1")
    expect(call().url.pathname).toBe("/v1/jobs/j1/restore")
    expect(call().init.method).toBe("POST")
  })

  it("list sends projectId, inSession (true and false) and withSessions", async () => {
    const { c, call } = client({ data: [], next: null })
    await c.jobs.list({ projectId: "p1", withSessions: true })
    expect(Object.fromEntries(call(0).url.searchParams)).toEqual({ projectId: "p1", withSessions: "true" })
    await c.jobs.list({ inSession: false })
    expect(call(1).url.searchParams.get("inSession")).toBe("false")
    await c.jobs.list({ inSession: true })
    expect(call(2).url.searchParams.get("inSession")).toBe("true")
    await c.jobs.list({})
    expect(call(3).url.search).toBe("")
  })
})
