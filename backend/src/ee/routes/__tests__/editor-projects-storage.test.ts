import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { randomBytes } from "node:crypto"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import { db, type ProjectRow } from "./editor-projects-fakes.js"
import { __heavyJobsStartedForTests as jobs } from "../../lib/editor-projects/heavy.js"
import { STORAGE_CEILING_BYTES, __resetStorageCeilingForTests } from "../../lib/editor-projects/storage-ceiling.js"
import { TAB, TAB2, envelope, heldProject, json, keysOf, patchFile, putFile, saveWhole, startApp, stopApp } from "./editor-projects-harness.js"

/**
 * The ceiling on the bytes of project files one person holds (2 GB: live
 * projects' current files plus their versions, summed by the database's
 * `editor_project_storage_bytes`), checked before a save or a cut writes.
 */

beforeEach(async () => {
  __resetStorageCeilingForTests()
  await startApp()
})
afterEach(async () => {
  vi.useRealTimers()
  await stopApp()
})

const cut = (p: ProjectRow) => json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "Manual edit", author: "you", holder: TAB })
const restore = (p: ProjectRow, n: number) => json("POST", `/v1/editor-projects/${p.id}/versions/${n}/restore`, { holder: TAB })
const asked = () => db.rpcCalls.filter((c) => c.name === "editor_project_storage_bytes").length
const full = { error: "project_storage_full" }

describe("the stored-bytes ceiling", () => {
  it("is 2 GB", () => {
    expect(STORAGE_CEILING_BYTES).toBe(2 * 1024 * 1024 * 1024)
  })

  it("within it, a save is stored, and the total was asked for first", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect(asked()).toBe(1)
  })

  it("a save that would pass it is 413 project_storage_full, stores nothing and does no heavy work", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { a: 1 })
    const before = keysOf(p)
    db.storageBytesExtra = STORAGE_CEILING_BYTES - 10
    const e = envelope({ a: "x".repeat(1000) })
    const started = jobs("content")
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual(full)
    expect(jobs("content")).toBe(started)
    const patched = await patchFile(p.id, [{ op: "replace", path: "/a", value: "y".repeat(1000) }], first.hash, e.hash)
    expect(patched.statusCode).toBe(413)
    expect(patched.json()).toEqual(full)
    expect(keysOf(p)).toEqual(before)
    expect(p.content_hash).toBe(first.hash)
  })

  it("a save of the content already saved answers saved: false even at the ceiling (it writes nothing)", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    db.storageBytesExtra = STORAGE_CEILING_BYTES
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: false })
  })

  it("a save counts the new file minus the one it replaces: replacing a file with one of the same size at the ceiling is never refused", async () => {
    const p = heldProject()
    await saveWhole(p, { a: "1" })
    // Exactly at the ceiling now.
    db.storageBytesExtra = STORAGE_CEILING_BYTES - (p.size_bytes ?? 0)
    const next = envelope({ a: "2" })
    expect(next.gz.length).toBe(p.size_bytes)
    const res = await putFile(p.id, next.gz, next.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    const patched = await patchFile(p.id, [{ op: "replace", path: "/a", value: "3" }], next.hash, envelope({ a: "3" }).hash)
    expect(patched.statusCode, patched.body).toBe(200)
  })

  it("the ownership check comes first: a project not held by this tab is 409, never 413", async () => {
    const p = heldProject({ holder_id: TAB2 })
    db.storageBytesExtra = STORAGE_CEILING_BYTES
    const e = envelope({ a: 1 })
    expect((await putFile(p.id, e.gz, e.hash)).json()).toEqual({ error: "not_holder" })
    expect(asked()).toBe(0)
  })

  it("a cut that would pass it is skipped on a save (the save stands), and refused on POST /versions", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    // Room for the save's own (larger) file, not for a version beside it.
    const e = envelope({ a: randomBytes(2000).toString("hex") })
    db.storageBytesExtra = STORAGE_CEILING_BYTES - e.gz.length - (p.size_bytes ?? 0)
    const res = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "Exported" })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(db.versions).toEqual([])
    const posted = await cut(p)
    expect(posted.statusCode).toBe(413)
    expect(posted.json()).toEqual(full)
    expect(db.versions).toEqual([])
  })

  it("a restore that would pass it is 413 and changes nothing", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    const second = await saveWhole(p, { a: 2 })
    db.storageBytesExtra = STORAGE_CEILING_BYTES
    const res = await restore(p, 1)
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual(full)
    expect(p.content_hash).toBe(second.hash)
    expect(db.versions).toHaveLength(1)
  })

  it("a database without the function has no ceiling, and is not asked again for 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    db.storageFunction = "missing"
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await saveWhole(p, { a: 2 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    expect(asked()).toBe(1)
    vi.setSystemTime(Date.now() + 61_000)
    await saveWhole(p, { a: 3 })
    expect(asked()).toBe(2)
  })

  it("any other error from the function is a 500, with nothing stored", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { a: 1 })
    const before = keysOf(p)
    db.storageBytesError = { code: "08006", message: "connection lost" }
    const e = envelope({ a: 2 })
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(500)
    expect(res.json().error).not.toBe("project_storage_full")
    expect(keysOf(p)).toEqual(before)
    expect(p.content_hash).toBe(first.hash)
  })

  it("a database without the project tables is still 503 not_available", async () => {
    const p = heldProject()
    db.missing = { code: "42P01", message: "relation does not exist" }
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: "not_available" })
  })
})
