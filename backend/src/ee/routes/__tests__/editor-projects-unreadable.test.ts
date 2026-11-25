import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { randomUUID } from "node:crypto"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import { db, storage, type ProjectRow } from "./editor-projects-fakes.js"
import { PROJECT_TEXT_MAX_BYTES } from "../../lib/editor-projects/store.js"
import { ME, TAB, envelope, heldProject, json, putFile, saveWhole, savedText, startApp, stopApp, onAnotherInstance } from "./editor-projects-harness.js"

/**
 * A project whose current file, or a version's file, is there but cannot be
 * verified: bytes that are not gzip, a row naming a key that is not the
 * project's own, an object larger than any saved project. None is ever
 * answered as content, and none is ever deleted by a repair.
 */

beforeEach(startApp)
afterEach(stopApp)

const cut = (p: ProjectRow) => json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "Manual edit", author: "you", holder: TAB })
const restore = (p: ProjectRow, n: number) => json("POST", `/v1/editor-projects/${p.id}/versions/${n}/restore`, { holder: TAB })

/** Saved {a:1} as version 1, then {a:2} as the current content and version 2 (the newest). */
async function twoVersions(cutSecond = true): Promise<{ p: ProjectRow; first: ReturnType<typeof envelope> }> {
  const p = heldProject()
  const first = await saveWhole(p, { a: 1 })
  expect((await cut(p)).json()).toEqual({ number: 1 })
  await saveWhole(p, { a: 2 })
  if (cutSecond) expect((await cut(p)).json()).toEqual({ number: 2 })
  return { p, first }
}

describe("a current file that is there but unverifiable", () => {
  it("an unchanged cut answers unchanged without reading it, and a restore then repairs it and keeps the bytes", async () => {
    const { p, first } = await twoVersions()
    const corrupt = p.blob_key!
    storage.objects.set(corrupt, { body: Buffer.from("these bytes are not gzip") })
    expect((await cut(p)).json()).toEqual({ number: null, unchanged: true })
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect(savedText(p)).toBe(first.text)
    // Nothing stood for the corrupt state, so no "Before restore" version, and its bytes stay.
    expect(db.versions.filter((v) => v.project_id === p.id).map((v) => v.label)).toEqual(["Manual edit", "Manual edit"])
    expect(storage.objects.has(corrupt)).toBe(true)
    expect(storage.deleted).not.toContain(corrupt)
  })

  it("a row whose key is not the project's own is never read, and a restore never deletes that file", async () => {
    const { p, first } = await twoVersions(false)
    // A real, matching file, but under another project's prefix.
    const foreign = `editor-projects/${ME}/${randomUUID()}/${randomUUID()}.json.gz`
    storage.objects.set(foreign, { body: storage.objects.get(p.blob_key!)!.body })
    p.blob_key = foreign
    const read = await json("GET", `/v1/editor-projects/${p.id}/file`)
    expect(read.statusCode).toBe(500)
    expect(read.json()).toEqual({ error: "file_missing" })
    const cutRes = await cut(p)
    expect(cutRes.statusCode).toBe(500)
    expect(cutRes.json()).toEqual({ error: "file_missing" })
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect(savedText(p)).toBe(first.text)
    expect(storage.objects.has(foreign)).toBe(true)
    expect(storage.deleted).not.toContain(foreign)
  })

  it("an object larger than any saved project is unverifiable: a cut is file_missing, a restore repairs and keeps it", async () => {
    const { p, first } = await twoVersions(false)
    const oversized = p.blob_key!
    storage.objects.set(oversized, { body: Buffer.alloc(PROJECT_TEXT_MAX_BYTES + 1) })
    const cutRes = await cut(p)
    expect(cutRes.statusCode).toBe(500)
    expect(cutRes.json()).toEqual({ error: "file_missing" })
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect(savedText(p)).toBe(first.text)
    expect(storage.objects.has(oversized)).toBe(true)
  })
})

describe("a version file that is larger than any saved project", () => {
  it("reading it answers version_unreadable, never other content", async () => {
    const { p } = await twoVersions()
    const v1 = db.versions.find((v) => v.project_id === p.id && v.number === 1)!
    storage.objects.set(v1.blob_key, { body: Buffer.alloc(PROJECT_TEXT_MAX_BYTES + 1) })
    const res = await json("GET", `/v1/editor-projects/${p.id}/file?version=1`)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "version_unreadable" })
  })
})

describe("a repairing restore", () => {
  it("never deletes the file it replaces, even when the same content came back under a new key meanwhile", async () => {
    const { p, first } = await twoVersions(false)
    const second = envelope({ a: 2 })
    // The current file is gone: the restore repairs.
    storage.objects.delete(p.blob_key!)
    let healthy: string | null = null
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        // Before the restore's save lands, the holder saves other content, then {a:2} again: a new, healthy file.
        expect((await saveWhole(p, { a: 3 })).hash).not.toBe(second.hash)
        expect((await putFile(p.id, second.gz, second.hash)).json()).toMatchObject({ saved: true })
        healthy = p.blob_key
      })
    }
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ repaired: true })
    expect(savedText(p)).toBe(first.text)
    // The file the restore's save replaced held {a:2}, healthy: it is kept.
    expect(healthy).not.toBeNull()
    expect(storage.objects.has(healthy!)).toBe(true)
    expect(storage.deleted).not.toContain(healthy)
  })
})

describe("a cut racing the project's delete", () => {
  it("a version whose row lands after the project was deleted is removed with its file, and the cut answers 404", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    const current = p.blob_key!
    let deleted: Awaited<ReturnType<typeof json>> | null = null
    db.beforeVersionInsert = async () => {
      // The cut's file is written; before its row lands, the project is deleted (another instance).
      deleted = await onAnotherInstance(() => json("DELETE", `/v1/editor-projects/${p.id}`))
    }
    const putsBefore = storage.puts.length
    const res = await cut(p)
    expect(deleted!.json()).toEqual({ deleted: true })
    expect(res.statusCode, res.body).toBe(404)
    expect(res.json()).toEqual({ error: "not_found" })
    const versionKey = storage.puts.slice(putsBefore).find((k) => k.includes("/v-"))!
    expect(versionKey).toBeDefined()
    expect(db.versions.filter((v) => v.project_id === p.id)).toEqual([])
    expect(storage.objects.has(versionKey)).toBe(false)
    expect(storage.objects.has(current)).toBe(false)
  })

  it("a delete whose second listing fails still deletes the version files it listed first", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    const v1 = db.versions.find((v) => v.project_id === p.id)!
    let listings = 0
    db.onVersionRead = (columns) => (columns === "blob_key" && ++listings === 2 ? { code: "08006", message: "connection lost" } : null)
    expect((await json("DELETE", `/v1/editor-projects/${p.id}`)).json()).toEqual({ deleted: true })
    expect(listings).toBe(2)
    expect(storage.objects.has(v1.blob_key)).toBe(false)
  })

  it("a delete lists the version files after its soft delete, so a version that landed just before it goes too", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    const v1 = db.versions.find((v) => v.project_id === p.id)!
    expect((await json("DELETE", `/v1/editor-projects/${p.id}`)).json()).toEqual({ deleted: true })
    expect(storage.objects.has(v1.blob_key)).toBe(false)
  })
})
