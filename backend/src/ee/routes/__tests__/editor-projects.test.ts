import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { gunzipSync } from "node:zlib"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import { db, seedProject, storage } from "./editor-projects-fakes.js"
import { editorProjectRoutes } from "../editor-projects.js"
import {
  ME, OTHER, TAB, TAB2, envelope, harness, heldProject, json, keysOf, patchFile, putFile, readBack, saveWhole, sha,
  startApp, stopApp,
} from "./editor-projects-harness.js"

/**
 * The editor-project routes other than the saves (editor-projects-saves.test.ts):
 * list, create, read, rename, delete, the one-tab claim, the file read, and
 * ownership, availability and scopes on every route.
 */

beforeEach(startApp)
afterEach(stopApp)

describe("projects: list, create, read, rename, delete", () => {
  it("lists only the caller's live projects, newest first", async () => {
    const old = seedProject({ user_id: ME, name: "Old", updated_at: "2026-11-01T00:00:00.000Z" })
    const recent = seedProject({ user_id: ME, name: "Recent", updated_at: "2026-11-20T00:00:00.000Z", revision: 3, size_bytes: 10 })
    seedProject({ user_id: ME, name: "Deleted", updated_at: "2026-11-21T00:00:00.000Z", deleted_at: "2026-11-22T00:00:00.000Z" })
    seedProject({ user_id: OTHER, name: "Theirs", updated_at: "2026-11-23T00:00:00.000Z" })
    const res = await json("GET", "/v1/editor-projects")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      projects: [
        { id: recent.id, name: "Recent", updated_at: recent.updated_at, size_bytes: 10, revision: 3 },
        { id: old.id, name: "Old", updated_at: old.updated_at, size_bytes: null, revision: 0 },
      ],
    })
  })

  it("takes a limit of 1 to 100 (default 50) and refuses any other", async () => {
    for (let i = 0; i < 60; i++) seedProject({ user_id: ME, updated_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })
    expect((await json("GET", "/v1/editor-projects")).json().projects).toHaveLength(50)
    expect((await json("GET", "/v1/editor-projects?limit=2")).json().projects).toHaveLength(2)
    for (const bad of ["0", "101", "x", "1.5"]) {
      const res = await json("GET", `/v1/editor-projects?limit=${bad}`)
      expect(res.statusCode, bad).toBe(400)
      expect(res.json().error).toBe("validation_error")
    }
  })

  it("needs a signed-in caller", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/v1/editor-projects" })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "unauthorized" })
  })

  it("creates a project with a trimmed name, and refuses an empty or long one", async () => {
    const res = await json("POST", "/v1/editor-projects", { name: "  My cut  " })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ id: expect.any(String), name: "My cut", revision: 0 })
    expect(db.projects.find((p) => p.id === body.id)?.user_id).toBe(ME)
    for (const name of ["   ", "x".repeat(121), 7]) {
      const bad = await json("POST", "/v1/editor-projects", { name })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().error).toBe("validation_error")
    }
  })

  it("reads one project with whether a live tab holds it and its versions", async () => {
    const p = seedProject({ user_id: ME, revision: 2, holder_id: TAB, holder_seen_at: new Date().toISOString() })
    db.versions.push({
      id: "v1", project_id: p.id, number: 1, label: "First", author: "you", kind: "full", base_number: null,
      content_hash: "a".repeat(64), size_bytes: 12, created_at: "2026-11-24T10:00:00.000Z",
      blob_key: `editor-projects/${ME}/${p.id}/v-00000000-0000-4000-8000-000000000001.json.gz`,
    })
    const res = await json("GET", `/v1/editor-projects/${p.id}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      id: p.id, name: "My cut", revision: 2, updated_at: p.updated_at, held: true,
      versions: [{ number: 1, label: "First", author: "you", created_at: "2026-11-24T10:00:00.000Z", size_bytes: 12, kind: "full" }],
    })
    // A claim not seen for 90 seconds is no longer held.
    p.holder_seen_at = new Date(Date.now() - 91_000).toISOString()
    expect((await json("GET", `/v1/editor-projects/${p.id}`)).json().held).toBe(false)
  })

  it("renames a project", async () => {
    const p = seedProject({ user_id: ME })
    const res = await json("PATCH", `/v1/editor-projects/${p.id}`, { name: " Two " })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: p.id, name: "Two" })
    expect(p.name).toBe("Two")
  })

  it("deletes a project softly and deletes the file its row names, and only that", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    const current = p.blob_key!
    // An orphan an earlier failed delete left behind is not this request's to delete.
    const orphan = `editor-projects/${ME}/${p.id}/00000000-0000-4000-8000-00000000aaaa.json.gz`
    storage.objects.set(orphan, { body: Buffer.from("x") })
    const res = await json("DELETE", `/v1/editor-projects/${p.id}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: true })
    expect(p.deleted_at).not.toBeNull()
    expect(storage.deleted).toEqual([current])
    expect(keysOf(p)).toEqual([orphan])
    // Gone from the list and from every route.
    expect((await json("GET", "/v1/editor-projects")).json().projects).toEqual([])
    expect((await json("GET", `/v1/editor-projects/${p.id}`)).statusCode).toBe(404)
    expect((await json("DELETE", `/v1/editor-projects/${p.id}`)).statusCode).toBe(404)
  })
})

describe("the one-tab claim", () => {
  it("claim is refused while another holder is live, granted with takeover, granted once the claim is stale, cleared by release", async () => {
    const p = seedProject({ user_id: ME })
    const claim = (holder: string, takeover?: boolean) =>
      json("POST", `/v1/editor-projects/${p.id}/claim`, { holder, ...(takeover === undefined ? {} : { takeover }) })

    expect((await claim(TAB)).json()).toEqual({ held: true })
    const refused = await claim(TAB2)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ error: "held_elsewhere" })
    expect(p.holder_id).toBe(TAB)

    expect((await claim(TAB2, true)).json()).toEqual({ held: true })
    expect(p.holder_id).toBe(TAB2)

    p.holder_seen_at = new Date(Date.now() - 91_000).toISOString()
    expect((await claim(TAB)).json()).toEqual({ held: true })
    expect(p.holder_id).toBe(TAB)

    // Only the holder releases.
    expect((await json("POST", `/v1/editor-projects/${p.id}/release`, { holder: TAB2 })).json()).toEqual({ released: false })
    expect((await json("POST", `/v1/editor-projects/${p.id}/release`, { holder: TAB })).json()).toEqual({ released: true })
    expect(p.holder_id).toBeNull()
    expect((await claim(TAB2)).json()).toEqual({ held: true })
  })

  it("refuses a holder that is not 8 to 64 letters, digits, - or _", async () => {
    const p = seedProject({ user_id: ME })
    for (const holder of ["short", "x".repeat(65), "has space ok", "bad/char1"]) {
      const res = await json("POST", `/v1/editor-projects/${p.id}/claim`, { holder })
      expect(res.statusCode, holder).toBe(400)
      expect(res.json().error).toBe("invalid_holder")
    }
    expect(db.rpcCalls).toEqual([])
  })
})

describe("GET /v1/editor-projects/:id/file", () => {
  it("answers 404 until the project is saved, then the gzip of the row's file with its revision, uncached", async () => {
    const p = heldProject()
    expect((await json("GET", `/v1/editor-projects/${p.id}/file`)).statusCode).toBe(404)
    const e = await saveWhole(p, { a: 1 })
    const res = await json("GET", `/v1/editor-projects/${p.id}/file`)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("application/gzip")
    expect(res.headers["x-revision"]).toBe("1")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["content-encoding"]).toBeUndefined()
    expect(gunzipSync(res.rawPayload).toString()).toBe(e.text)
  })

  it("a row with a missing blob answers file_missing", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    storage.objects.delete(p.blob_key!)
    const res = await json("GET", `/v1/editor-projects/${p.id}/file`)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "file_missing" })
  })

  it("serves the new file when a save replaced the row's file while it was being read", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    let second: { text: string } | undefined
    storage.beforeStream = async () => {
      second = await saveWhole(p, { v: 2 })
    }
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: second!.text })
  })

  it("takes a version number and nothing else; a version that does not exist is 404", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await json("GET", `/v1/editor-projects/${p.id}/file?version=1`)).json()).toEqual({ error: "not_found" })
    expect((await json("GET", `/v1/editor-projects/${p.id}/file?version=x`)).statusCode).toBe(400)
    expect((await json("GET", `/v1/editor-projects/${p.id}/file?revision=1`)).statusCode).toBe(400)
  })
})

describe("ownership, availability and scopes on every route", () => {
  /** Every route, called on project `id` by `user`, with a well-formed request. */
  function everyRoute(id: string, user: string) {
    const e = envelope({ a: 1 })
    return [
      ["GET /:id", () => json("GET", `/v1/editor-projects/${id}`, undefined, user)],
      ["PATCH /:id", () => json("PATCH", `/v1/editor-projects/${id}`, { name: "x" }, user)],
      ["DELETE /:id", () => json("DELETE", `/v1/editor-projects/${id}`, undefined, user)],
      ["POST /:id/claim", () => json("POST", `/v1/editor-projects/${id}/claim`, { holder: TAB }, user)],
      ["POST /:id/release", () => json("POST", `/v1/editor-projects/${id}/release`, { holder: TAB }, user)],
      ["GET /:id/file", () => json("GET", `/v1/editor-projects/${id}/file`, undefined, user)],
      ["PUT /:id/file", () => putFile(id, e.gz, e.hash, {}, user)],
      ["PATCH /:id/file", () => patchFile(id, [], e.hash, e.hash, {}, user)],
      ["GET /:id/file?version", () => json("GET", `/v1/editor-projects/${id}/file?version=1`, undefined, user)],
      ["POST /:id/versions", () => json("POST", `/v1/editor-projects/${id}/versions`, { label: "x", author: "you", holder: TAB }, user)],
      ["POST /:id/versions/:n/restore", () => json("POST", `/v1/editor-projects/${id}/versions/1/restore`, { holder: TAB }, user)],
    ] as const
  }

  it("another user's project answers 404 on every route", async () => {
    const theirs = seedProject({ user_id: OTHER, holder_id: TAB, holder_seen_at: new Date().toISOString(), content_hash: sha("x") })
    for (const [name, call] of everyRoute(theirs.id, ME)) {
      const res = await call()
      expect(res.statusCode, name).toBe(404)
      expect(res.json(), name).toEqual({ error: "not_found" })
    }
    expect(theirs.deleted_at).toBeNull()
    expect(theirs.name).toBe("My cut")
    expect(storage.puts).toEqual([])
  })

  it("a malformed id answers 404 on every route", async () => {
    for (const [name, call] of everyRoute("not-a-uuid", ME)) {
      const res = await call()
      expect(res.statusCode, name).toBe(404)
      expect(res.json(), name).toEqual({ error: "not_found" })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it("every route answers 503 not_available when the table does not exist", async () => {
    const p = heldProject()
    db.missing = { code: "42P01", message: 'relation "public.editor_projects" does not exist' }
    const routes = [
      ["GET /", () => json("GET", "/v1/editor-projects")],
      ["POST /", () => json("POST", "/v1/editor-projects", { name: "x" })],
      ...everyRoute(p.id, ME),
    ] as const
    for (const [name, call] of routes) {
      const res = await call()
      expect(res.statusCode, name).toBe(503)
      expect(res.json(), name).toEqual({ error: "not_available" })
    }
    expect(storage.puts).toEqual([])
  })

  it("answers 503 not_available when the schema cache has no such table or function", async () => {
    const p = heldProject()
    db.missing = { code: "PGRST205", message: "Could not find the table" }
    expect((await json("GET", `/v1/editor-projects/${p.id}`)).statusCode).toBe(503)
    db.missing = { code: "PGRST202", message: "Could not find the function public.editor_project_claim" }
    const claim = await json("POST", `/v1/editor-projects/${p.id}/claim`, { holder: TAB })
    expect(claim.statusCode).toBe(503)
    expect(claim.json()).toEqual({ error: "not_available" })
  })

  it("every route answers 503 not_available on a deployment with no private bucket, never touching the media bucket", async () => {
    const p = heldProject()
    storage.configured = false
    const routes = [
      ["GET /", () => json("GET", "/v1/editor-projects")],
      ["POST /", () => json("POST", "/v1/editor-projects", { name: "x" })],
      ...everyRoute(p.id, ME),
    ] as const
    for (const [name, call] of routes) {
      const res = await call()
      expect(res.statusCode, name).toBe(503)
      expect(res.json(), name).toEqual({ error: "not_available" })
    }
    expect(db.rpcCalls).toEqual([])
    expect(db.projects).toHaveLength(1)
  })

  it("scopes OAuth app tokens: reads need assets:read, writes assets:write", async () => {
    const seen: Record<string, unknown[]> = {}
    const probe = Fastify({ logger: false })
    probe.addHook("onRoute", (opts) => {
      if (String(opts.url).startsWith("/v1/editor-projects") && opts.method !== "HEAD") seen[`${opts.method} ${opts.url}`] = [opts.preHandler].flat()
    })
    await probe.register(editorProjectRoutes)
    await probe.ready()
    await probe.close()
    expect(Object.keys(seen).sort()).toEqual([
      "DELETE /v1/editor-projects/:id", "GET /v1/editor-projects", "GET /v1/editor-projects/:id", "GET /v1/editor-projects/:id/file",
      "PATCH /v1/editor-projects/:id", "PATCH /v1/editor-projects/:id/file", "POST /v1/editor-projects", "POST /v1/editor-projects/:id/claim",
      "POST /v1/editor-projects/:id/release", "POST /v1/editor-projects/:id/versions", "POST /v1/editor-projects/:id/versions/:n/restore",
      "PUT /v1/editor-projects/:id/file",
    ])
    for (const handlers of Object.values(seen)) expect(handlers.length).toBe(1)

    // An app holding only a read scope reads, and is refused a write.
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      req.userId = ME
      req.appAuthorization = { scopes: ["assets:read"] } as never
    })
    await app.register(editorProjectRoutes)
    await app.ready()
    expect((await app.inject({ method: "GET", url: "/v1/editor-projects" })).statusCode).toBe(200)
    const write = await app.inject({ method: "POST", url: "/v1/editor-projects", payload: { name: "x" } })
    expect(write.statusCode).toBe(403)
    const p = heldProject()
    const e = envelope({ a: 1 })
    const put = await app.inject({
      method: "PUT", url: `/v1/editor-projects/${p.id}/file`, payload: e.gz,
      headers: { "content-type": "application/gzip", "x-holder": TAB, "x-content-hash": e.hash },
    })
    expect(put.statusCode).toBe(403)
    await app.close()
    expect(await readBack(p)).toMatchObject({ status: 404 })
  })
})
