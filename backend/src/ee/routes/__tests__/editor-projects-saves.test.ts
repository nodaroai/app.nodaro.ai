import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { gunzipSync, gzipSync } from "node:zlib"
import { randomBytes } from "node:crypto"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import jsonpatch from "fast-json-patch"
import { db, storage } from "./editor-projects-fakes.js"
import { editorProjectRoutes } from "../editor-projects.js"
import { registerUploadPolicy } from "../../../lib/upload-policy.js"
import {
  MB, TAB, TAB2, envelope, heldProject, json, keysOf, patchFile, putFile, readBack, saveWhole, savedText, sha, startApp, stopApp, onAnotherInstance,
} from "./editor-projects-harness.js"

/**
 * Saving a project's content (PUT whole, PATCH as a JSON Patch) into the
 * private bucket: one file per save under a key never reused, the row naming
 * its current file, and the interleavings of saves in flight.
 */

beforeEach(startApp)
afterEach(stopApp)

const KEY = /^editor-projects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.json\.gz$/

describe("PUT /v1/editor-projects/:id/file", () => {
  it("declares the per-credential rate limit on both save routes", async () => {
    const seen: Record<string, unknown> = {}
    const probe = Fastify({ logger: false })
    probe.addHook("onRoute", (opts) => {
      if (opts.url === "/v1/editor-projects/:id/file" && (opts.method === "PUT" || opts.method === "PATCH")) seen[opts.method] = opts.config
    })
    await probe.register(editorProjectRoutes)
    await probe.ready()
    await probe.close()
    expect(seen.PUT).toMatchObject({ rateLimit: { max: 120, timeWindow: "1 minute" } })
    expect(seen.PATCH).toMatchObject({ rateLimit: { max: 120, timeWindow: "1 minute" } })
  })

  it("a PUT from the holder stores the blob under a fresh key and bumps the revision", async () => {
    const p = heldProject()
    const e = envelope({ b: [1, 2], a: { z: true, y: null } })
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: true })
    expect(p.content_hash).toBe(e.hash)
    expect(p.revision).toBe(1)
    expect(p.blob_key).toMatch(KEY)
    expect(p.blob_key!.startsWith(`editor-projects/${p.user_id}/${p.id}/`)).toBe(true)
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(savedText(p)).toBe(e.text)
    expect(p.size_bytes).toBe(storage.objects.get(p.blob_key!)!.body.length)
    expect(storage.deleted).toEqual([])
  })

  it("re-canonicalises what it receives: a body with whitespace and unsorted keys saves under the canonical hash", async () => {
    const p = heldProject()
    const e = envelope({ b: 1, a: 2 })
    const res = await putFile(p.id, gzipSync(Buffer.from('{ "b": 1,\n  "a": 2 }', "utf8")), e.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(savedText(p)).toBe('{"a":2,"b":1}')
  })

  it("a PUT with the same hash as the stored one answers saved: false and writes no blob", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    storage.puts = []
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: false })
    expect(storage.puts).toEqual([])
    expect(p.revision).toBe(1)
  })

  it("a save writes a new key each time and deletes exactly the key it replaced", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    const first = p.blob_key!
    const second = await saveWhole(p, { v: 2 })
    expect(p.revision).toBe(2)
    expect(p.blob_key).not.toBe(first)
    expect(storage.deleted).toEqual([first])
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: second.text })
  })

  it("a PUT from a tab that is not the holder is refused 409 not_holder and stores nothing", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash, { "x-holder": TAB2 })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "not_holder" })
    expect(storage.puts).toEqual([])
    expect(db.rpcCalls).toEqual([])
  })

  it("a tab that loses the claim between its check and its save stores nothing", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    db.beforeSave = () => {
      p.holder_id = TAB2
    }
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "not_holder" })
    expect(keysOf(p)).toEqual([])
    expect(p.content_hash).toBeNull()
  })

  it("the holder saves after being idle longer than the stale age", async () => {
    const p = heldProject({ holder_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() })
    const e = envelope({ idle: true })
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.json()).toEqual({ revision: 1, saved: true })
  })

  it("a failed RPC (an unknown outcome) leaves the previous file readable, and its new file as an orphan", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    db.saveError = { code: "XX000", message: "the database failed" }
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).statusCode).toBe(500)
    expect(storage.deleted).toEqual([])
    expect(keysOf(p)).toHaveLength(2)
    expect(p.blob_key).toBe(firstKey)
    db.saveError = null
    expect(await readBack(p)).toEqual({ status: 200, revision: "1", text: first.text })
  })

  it("a named refusal deletes the file the save wrote", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    db.beforeSave = () => {
      p.holder_id = TAB2
    }
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).json()).toEqual({ error: "not_holder" })
    expect(keysOf(p)).toEqual([firstKey])
  })

  it("a save that landed but whose answer was lost answers 200 saved, and its file reads", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    db.saveErrorAfterCommit = { code: "ECONNRESET", message: "connection reset" }
    const next = envelope({ v: 2 })
    const res = await putFile(p.id, next.gz, next.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: next.text })
    // The key it replaced is unknown to this request: nothing is deleted (the old file stays an orphan).
    expect(storage.deleted).toEqual([])
    expect(keysOf(p)).toEqual([firstKey, p.blob_key].sort())
    expect(first.hash).not.toBe(next.hash)
  })

  it("a save whose outcome is unknown and has not landed keeps its new file (an orphan), and the previous content reads", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    db.saveError = { code: "ECONNRESET", message: "connection reset" }
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).statusCode).toBe(500)
    // The call may still commit: the file it wrote is never deleted on an unknown outcome.
    expect(storage.deleted).toEqual([])
    expect(keysOf(p)).toHaveLength(2)
    expect(keysOf(p)).toContain(firstKey)
    db.saveError = null
    expect(await readBack(p)).toEqual({ status: 200, revision: "1", text: first.text })
  })

  it("a save still in flight when its answer is lost: the re-read shows the old key, the late commit names the new one, and the project reads", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    // A transport failure: no SQLSTATE at all.
    db.saveError = { message: "TypeError: fetch failed" } as never
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).statusCode).toBe(500)
    expect(p.blob_key).toBe(firstKey)
    // The call commits after the request gave up.
    const written = keysOf(p).find((k) => k !== firstKey)!
    Object.assign(p, { content_hash: next.hash, blob_key: written, revision: p.revision + 1 })
    expect(storage.objects.has(written)).toBe(true)
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: next.text })
  })

  it("a save whose outcome is unknown and whose row cannot be re-read answers 500 and deletes nothing", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    const firstKey = p.blob_key!
    db.saveErrorAfterCommit = { code: "ECONNRESET", message: "connection reset" }
    db.afterSave = () => {
      db.readError = { code: "XX000", message: "the database went away" }
    }
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).statusCode).toBe(500)
    expect(storage.deleted).toEqual([])
    expect(keysOf(p)).toEqual([firstKey, p.blob_key].sort())
    db.readError = null
    db.saveErrorAfterCommit = null
    // It had landed: the project reads its new content.
    expect((await readBack(p)).text).toBe(next.text)
  })

  it("a same-content save of a row whose file is gone is never answered as saved", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { v: 1 })
    storage.objects.delete(p.blob_key!)
    const res = await putFile(p.id, first.gz, first.hash)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "file_missing" })
  })

  it("a failed write of the new key answers 500 and the previous content still reads at the old revision", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { v: 1 })
    storage.failPut = () => true
    const next = envelope({ v: 2 })
    expect((await putFile(p.id, next.gz, next.hash)).statusCode).toBe(500)
    expect(db.rpcCalls.filter((c) => c.name === "editor_project_save")).toHaveLength(1)
    storage.failPut = null
    expect(await readBack(p)).toEqual({ status: 200, revision: "1", text: first.text })
  })

  it("a failed delete of the old blob still answers 200 and the read serves the new content", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    const first = p.blob_key!
    storage.failDelete = (key) => key === first
    const second = envelope({ v: 2 })
    const res = await putFile(p.id, second.gz, second.hash)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(keysOf(p)).toEqual([first, p.blob_key].sort())
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: second.text })
  })

  it("a failed delete, a return to earlier content, then the retry's delete of the recorded key: the project still reads", async () => {
    const p = heldProject()
    const v1 = await saveWhole(p, { v: 1 })
    const k1 = p.blob_key!
    storage.failDelete = (key) => key === k1
    await saveWhole(p, { v: 2 })
    storage.failDelete = null
    // Back to v1: its content is saved again under a new key, never k1.
    await saveWhole(p, v1.value)
    expect(p.blob_key).not.toBe(k1)
    // A later pass deletes the orphan it was told about.
    storage.objects.delete(k1)
    expect(await readBack(p)).toEqual({ status: 200, revision: "3", text: v1.text })
  })

  it("two saves in flight (A and C): the row ends pointing at a file that exists", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 0 })
    const a = envelope({ v: "A" })
    const c = envelope({ v: "C" })
    // A has written its file; before the database records it, C saves whole.
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        const res = await putFile(p.id, c.gz, c.hash)
        expect(res.json()).toEqual({ revision: 2, saved: true })
      })
    }
    const res = await putFile(p.id, a.gz, a.hash)
    expect(res.json()).toEqual({ revision: 3, saved: true })
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(await readBack(p)).toEqual({ status: 200, revision: "3", text: a.text })
  })

  it("a save racing one of the same content keeps the row's file and discards its own", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 0 })
    const same = envelope({ v: 1 })
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        expect((await putFile(p.id, same.gz, same.hash)).json()).toEqual({ revision: 2, saved: true })
      })
    }
    const res = await putFile(p.id, same.gz, same.hash)
    expect(res.json()).toEqual({ revision: 2, saved: false })
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: same.text })
  })

  it("a takeover saving the same content while the old holder's save is refused: the row's file exists", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 0 })
    const same = envelope({ v: 1 })
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        p.holder_id = TAB2
        expect((await putFile(p.id, same.gz, same.hash, { "x-holder": TAB2 })).json()).toEqual({ revision: 2, saved: true })
      })
    }
    const res = await putFile(p.id, same.gz, same.hash)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "not_holder" })
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(await readBack(p)).toEqual({ status: 200, revision: "2", text: same.text })
  })

  it("a whole save of content that matched a row since moved on saves it as new", async () => {
    const p = heldProject()
    const v1 = await saveWhole(p, { v: 1 })
    // The row is read at v1; before the refresh lands, another save moves it on.
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        await saveWhole(p, { v: 2 })
      })
    }
    const res = await putFile(p.id, v1.gz, v1.hash)
    expect(res.json()).toEqual({ revision: 3, saved: true })
    expect(await readBack(p)).toEqual({ status: 200, revision: "3", text: v1.text })
    expect(keysOf(p)).toEqual([p.blob_key])
  })

  it("a PUT whose body hash does not match its header is refused 422", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, sha("something else"))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "hash_mismatch" })
    expect(storage.puts).toEqual([])
  })

  it("a PUT over 5 MB is refused 413", async () => {
    const p = heldProject()
    const res = await putFile(p.id, randomBytes(5 * MB + 1), sha("x"))
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: "too_large" })
  })

  it("a small body that inflates past the 8 MB cap is refused 413", async () => {
    const p = heldProject()
    const bomb = gzipSync(Buffer.alloc(9 * MB, 0x20))
    expect(bomb.length).toBeLessThan(MB)
    const res = await putFile(p.id, bomb, sha("x"))
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: "too_large" })
    expect(storage.puts).toEqual([])
  })

  it("refuses a body that is not gzip, or not JSON", async () => {
    const p = heldProject()
    expect((await putFile(p.id, Buffer.from("plain"), sha("x"))).json()).toEqual({ error: "invalid_gzip" })
    expect((await putFile(p.id, gzipSync(Buffer.from("{nope")), sha("x"))).json()).toEqual({ error: "invalid_json" })
  })

  it("refuses a malformed holder, hash or cut-version header with 400, and a good cut-version cuts a version", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const cases: Array<[Record<string, string>, string]> = [
      [{ "x-holder": "short" }, "invalid_holder"],
      [{ "x-content-hash": "ABC" }, "invalid_content"],
      [{ "x-content-hash": e.hash.toUpperCase() }, "invalid_content"],
      [{ "x-cut-version": "%E0%A4%A" }, "validation_error"],
      [{ "x-cut-version": encodeURIComponent("x".repeat(121)) }, "validation_error"],
      [{ "x-cut-version": "" }, "validation_error"],
    ]
    for (const [headers, code] of cases) {
      const res = await putFile(p.id, e.gz, e.hash, headers)
      expect(res.statusCode, JSON.stringify(headers)).toBe(400)
      expect(res.json().error).toBe(code)
    }
    expect(storage.puts).toEqual([])
    const ok = await putFile(p.id, e.gz, e.hash, { "x-cut-version": encodeURIComponent("Rough cut — v1") })
    expect(ok.json()).toEqual({ revision: 1, saved: true, version: 1 })
  })

  it("an upload policy that refuses the project stores nothing", async () => {
    const seen: string[] = []
    registerUploadPolicy({ id: "no", check: (input) => (seen.push(`${input.lane}:${input.kind}`), { allow: false }) })
    const p = heldProject()
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "upload_blocked" })
    expect(seen).toEqual(["editor-project:json"])
    expect(storage.puts).toEqual([])
    // Only the stored-bytes total was read; nothing was saved.
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["editor_project_storage_bytes"])
  })
})

describe("PATCH /v1/editor-projects/:id/file", () => {
  it("applies a JSON Patch to the saved content and saves the result", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { title: "A", clips: [1, 2] })
    const next = envelope({ title: "B", clips: [1, 2, 3] })
    const ops = [
      { op: "replace", path: "/title", value: "B" },
      { op: "add", path: "/clips/-", value: 3 },
    ]
    const res = await patchFile(p.id, ops, base.hash, next.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(savedText(p)).toBe(next.text)
    expect(keysOf(p)).toEqual([p.blob_key])
  })

  it("the same PATCH sent twice answers saved, then saved: false at the same revision, with one file", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const next = envelope({ a: 2 })
    const ops = [{ op: "replace", path: "/a", value: 2 }]
    expect((await patchFile(p.id, ops, base.hash, next.hash)).json()).toEqual({ revision: 2, saved: true })
    expect((await patchFile(p.id, ops, base.hash, next.hash)).json()).toEqual({ revision: 2, saved: false })
    expect(keysOf(p)).toEqual([p.blob_key])
  })

  it("a retried PATCH whose first attempt landed while it was in flight answers saved: false and keeps one file", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const next = envelope({ a: 2 })
    const ops = [{ op: "replace", path: "/a", value: 2 }]
    // The first attempt lands after the retry read the row and wrote its file.
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        expect((await patchFile(p.id, ops, base.hash, next.hash)).json()).toEqual({ revision: 2, saved: true })
      })
    }
    const res = await patchFile(p.id, ops, base.hash, next.hash)
    expect(res.json()).toEqual({ revision: 2, saved: false })
    expect(keysOf(p)).toEqual([p.blob_key])
  })

  it("a PATCH whose RPC answers base_mismatch stores nothing and answers 409", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const next = envelope({ a: 2 })
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        await saveWhole(p, { a: "other" })
      })
    }
    const res = await patchFile(p.id, [{ op: "replace", path: "/a", value: 2 }], base.hash, next.hash)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "base_mismatch" })
    expect(keysOf(p)).toEqual([p.blob_key])
    expect(savedText(p)).toBe(envelope({ a: "other" }).text)
  })

  it("answers 409 base_mismatch when x-base-hash is not the project's hash, or the project was never saved", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await patchFile(p.id, [], sha("older"), sha("whatever"))).json()).toEqual({ error: "base_mismatch" })
    const never = heldProject()
    expect((await patchFile(never.id, [], sha("x"), sha("y"))).json()).toEqual({ error: "base_mismatch" })
  })

  it("a row with a missing blob answers file_missing", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    storage.objects.delete(p.blob_key!)
    const res = await patchFile(p.id, [{ op: "replace", path: "/a", value: 2 }], base.hash, envelope({ a: 2 }).hash)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "file_missing" })
  })

  it("a project deleted while its base was being read answers 404", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    storage.beforeRead = () => {
      p.deleted_at = new Date().toISOString()
      storage.objects.delete(p.blob_key!)
    }
    const res = await patchFile(p.id, [{ op: "replace", path: "/a", value: 2 }], base.hash, envelope({ a: 2 }).hash)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: "not_found" })
  })

  it("a copy-doubling patch is refused at once, before anything is applied", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { big: "x".repeat(MB) })
    const spy = vi.spyOn(jsonpatch, "applyPatch")
    const ops = Array.from({ length: 14 }, (_, i) => ({ op: "copy", from: "", path: `/c${i}` }))
    const res = await patchFile(p.id, ops, base.hash, sha("x"))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "patch_failed" })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("refuses a move, an unknown op and a patch of over 20,000 operations", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1, b: 2 })
    storage.puts = []
    const tooMany = Array.from({ length: 20_001 }, () => ({ op: "test", path: "/a", value: 1 }))
    for (const ops of [[{ op: "move", from: "/a", path: "/c" }], [{ op: "nope", path: "/a" }], tooMany]) {
      const res = await patchFile(p.id, ops, base.hash, sha("x"))
      expect(res.statusCode).toBe(422)
      expect(res.json()).toEqual({ error: "patch_failed" })
    }
    // 20,000 is still taken.
    const atCap = Array.from({ length: 20_000 }, () => ({ op: "test", path: "/a", value: 1 }))
    expect((await patchFile(p.id, atCap, base.hash, base.hash)).json()).toEqual({ revision: 1, saved: false })
    expect(storage.puts).toEqual([])
  })

  it("a patch that fails to apply, or names a banned key, answers 422 patch_failed and stores nothing", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    storage.puts = []
    const bad: unknown[] = [
      [{ op: "test", path: "/a", value: 2 }],
      [{ op: "remove", path: "/missing" }],
      [{ op: "add", path: "/__proto__/polluted", value: true }],
      { op: "add", path: "/b", value: 1 },
    ]
    for (const ops of bad) {
      const res = await patchFile(p.id, ops, base.hash, sha("x"))
      expect(res.statusCode, JSON.stringify(ops)).toBe(422)
      expect(res.json()).toEqual({ error: "patch_failed" })
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(storage.puts).toEqual([])
    expect(p.revision).toBe(1)
  })

  it("answers 422 hash_mismatch when the patched result is not x-content-hash", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const res = await patchFile(p.id, [{ op: "replace", path: "/a", value: 2 }], base.hash, sha("not it"))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "hash_mismatch" })
  })

  it("refuses a patch body over 1 MB, or one that inflates past 5 MB, with 413", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    expect((await patchFile(p.id, randomBytes(MB + 1), base.hash, sha("x"))).statusCode).toBe(413)
    const bomb = await patchFile(p.id, gzipSync(Buffer.alloc(6 * MB, 0x20)), base.hash, sha("x"))
    expect(bomb.statusCode).toBe(413)
    expect(bomb.json()).toEqual({ error: "too_large" })
  })

  it("refuses a tab that is not the holder before comparing the base", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    expect((await patchFile(p.id, [], sha("older"), base.hash, { "x-holder": TAB2 })).json()).toEqual({ error: "not_holder" })
  })

  it("an empty patch saves nothing new", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    storage.puts = []
    expect((await patchFile(p.id, [], base.hash, base.hash)).json()).toEqual({ revision: 1, saved: false })
    expect(storage.puts).toEqual([])
    expect(gunzipSync(storage.objects.get(p.blob_key!)!.body).toString()).toBe(base.text)
  })
})
