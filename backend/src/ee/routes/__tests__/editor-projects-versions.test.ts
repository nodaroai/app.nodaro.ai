import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { gunzipSync, gzipSync } from "node:zlib"
import { randomBytes } from "node:crypto"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import jsonpatch from "fast-json-patch"
import { db, seedProject, storage, type ProjectRow } from "./editor-projects-fakes.js"
import {
  ME, OTHER, TAB, TAB2, envelope, heldProject, json, keysOf, patchFile, putFile, readBack, saveWhole, savedText, sha, startApp, stopApp, onAnotherInstance,
} from "./editor-projects-harness.js"

/**
 * A project's labelled versions: cut from the saved content by the platform
 * (POST /:id/versions, or `x-cut-version` on a save), stored whole or as a
 * patch against a whole version, read back whole and verified by hash
 * (GET /:id/file?version=n), restored (POST /:id/versions/:n/restore) and
 * thinned past 50.
 */

beforeEach(startApp)
afterEach(stopApp)
// A user's cuts are counted per minute (30): the clock moves on with each cut,
// so a test may cut the 50 and more versions thinning needs.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => {
  vi.useRealTimers()
})

const VERSION_KEY = /^editor-projects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/v-[0-9a-f-]{36}\.json\.gz$/

/** A project big and varied enough that a small change gzips to well under a quarter of it. */
function bigProject(title = "Cut", extra: Record<string, unknown> = {}) {
  return {
    title,
    clips: Array.from({ length: 120 }, (_, i) => ({ id: `clip-${i}`, start: i * 2, note: randomBytes(12).toString("hex") })),
    ...extra,
  }
}

async function cut(p: ProjectRow, label = "Manual edit", author = "you", holder = TAB, user = ME) {
  const res = await json("POST", `/v1/editor-projects/${p.id}/versions`, { label, author, holder }, user)
  vi.setSystemTime(Date.now() + 2_100)
  return res
}

async function cutOk(p: ProjectRow, label = "Manual edit", author = "you"): Promise<number> {
  const res = await cut(p, label, author)
  expect(res.statusCode, res.body).toBe(200)
  const number = res.json().number
  expect(typeof number).toBe("number")
  return number
}

async function readVersion(p: ProjectRow, n: number | string) {
  const res = await json("GET", `/v1/editor-projects/${p.id}/file?version=${n}`)
  return {
    res,
    status: res.statusCode,
    text: res.statusCode === 200 ? gunzipSync(res.rawPayload).toString("utf8") : null,
  }
}

const restore = (p: ProjectRow, n: number, holder = TAB) => json("POST", `/v1/editor-projects/${p.id}/versions/${n}/restore`, { holder })

const versionOf = (p: ProjectRow, n: number) => db.versions.find((v) => v.project_id === p.id && v.number === n)

describe("cutting a version", () => {
  it("a first version is stored whole, under its own key, as a copy of the saved file", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    const res = await cut(p, "  Rough cut  ", " you ")
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ number: 1 })
    const v = versionOf(p, 1)!
    expect(v).toMatchObject({ label: "Rough cut", author: "you", kind: "full", base_number: null, content_hash: e.hash })
    expect(v.blob_key).toMatch(VERSION_KEY)
    expect(v.blob_key.startsWith(`editor-projects/${ME}/${p.id}/`)).toBe(true)
    expect(v.blob_key).not.toBe(p.blob_key)
    expect(v.size_bytes).toBe(storage.objects.get(v.blob_key)!.body.length)
    expect(gunzipSync(storage.objects.get(v.blob_key)!.body).toString("utf8")).toBe(e.text)
    // The file is written before the row.
    expect(storage.puts.indexOf(v.blob_key)).toBeGreaterThanOrEqual(0)
  })

  it("cutting a version of unchanged content creates none", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect(await cutOk(p)).toBe(1)
    const puts = storage.puts.length
    const res = await cut(p, "Again")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ number: null, unchanged: true })
    expect(db.versions).toHaveLength(1)
    expect(storage.puts).toHaveLength(puts)
    // A change, then back: the content differs from the newest version again.
    await saveWhole(p, { a: 2 })
    expect(await cutOk(p)).toBe(2)
  })

  it("needs the holder, a label of 1 to 120 and an author of 1 to 60, and a saved project", async () => {
    const p = heldProject()
    expect((await cut(p)).json()).toEqual({ error: "not_found" })
    await saveWhole(p, { a: 1 })
    expect((await cut(p, "x", "you", TAB2)).statusCode).toBe(409)
    expect((await cut(p, "x", "you", TAB2)).json()).toEqual({ error: "not_holder" })
    expect((await cut(p, "x", "you", "short")).json()).toEqual({ error: "invalid_holder" })
    for (const [label, author] of [["", "you"], ["   ", "you"], ["x".repeat(121), "you"], ["x", ""], ["x", "y".repeat(61)]]) {
      const res = await cut(p, label, author)
      expect(res.statusCode, `${label}/${author}`).toBe(400)
      expect(res.json().error).toBe("validation_error")
    }
    expect((await json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "x", author: "you" })).statusCode).toBe(400)
    expect(db.versions).toEqual([])
    expect(await cutOk(p, "x".repeat(120), "y".repeat(60))).toBe(1)
  })

  it("a second version of a slightly changed project is stored as a patch", async () => {
    const p = heldProject()
    const first = bigProject()
    await saveWhole(p, first)
    expect(await cutOk(p)).toBe(1)
    const second = { ...first, title: "Cut 2" }
    const e2 = await saveWhole(p, second)
    expect(await cutOk(p)).toBe(2)
    const v2 = versionOf(p, 2)!
    expect(v2).toMatchObject({ kind: "patch", base_number: 1, content_hash: e2.hash })
    const stored = JSON.parse(gunzipSync(storage.objects.get(v2.blob_key)!.body).toString("utf8"))
    expect(stored).toEqual([{ op: "replace", path: "/title", value: "Cut 2" }])
    expect(v2.size_bytes * 4).toBeLessThan(versionOf(p, 1)!.size_bytes)
  })

  it("a change too large for a patch is stored whole", async () => {
    const p = heldProject()
    await saveWhole(p, bigProject())
    await cutOk(p)
    await saveWhole(p, bigProject("Other"))
    await cutOk(p)
    expect(versionOf(p, 2)).toMatchObject({ kind: "full", base_number: null })
  })

  it("a version read from a patch equals the working copy it was cut from", async () => {
    const p = heldProject()
    const first = bigProject()
    await saveWhole(p, first)
    await cutOk(p)
    const changed = { ...first, clips: [...first.clips.slice(0, 50), { id: "new", start: 1 }, ...first.clips.slice(51)] }
    await saveWhole(p, changed)
    await cutOk(p)
    const working = savedText(p)
    expect(versionOf(p, 2)!.kind).toBe("patch")
    const v2 = await readVersion(p, 2)
    expect(v2.status, v2.res.body).toBe(200)
    expect(v2.text).toBe(working)
    expect(sha(v2.text!)).toBe(p.content_hash)
    const v1 = await readVersion(p, 1)
    expect(v1.text).toBe(envelope(first).text)
  })

  it("the 21st patch on one full version starts a new full version", async () => {
    const p = heldProject()
    const base = bigProject()
    await saveWhole(p, base)
    await cutOk(p)
    for (let i = 1; i <= 20; i++) {
      await saveWhole(p, { ...base, title: `Cut ${i}` })
      await cutOk(p)
    }
    expect(db.versions.filter((v) => v.kind === "patch" && v.base_number === 1)).toHaveLength(20)
    await saveWhole(p, { ...base, title: "Cut 21" })
    expect(await cutOk(p)).toBe(22)
    expect(versionOf(p, 22)).toMatchObject({ kind: "full", base_number: null })
    await saveWhole(p, { ...base, title: "Cut 22" })
    await cutOk(p)
    expect(versionOf(p, 23)).toMatchObject({ kind: "patch", base_number: 22 })
    expect((await readVersion(p, 23)).text).toBe(savedText(p))
  })

  it("two cuts racing for one number: the loser takes the next number and keeps its file", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    db.beforeVersionInsert = () => {
      // Another cut lands number 2 meanwhile.
      db.versions.push({
        id: "racer", project_id: p.id, number: 2, label: "Racer", author: "you", kind: "full", base_number: null,
        content_hash: sha("racer"), size_bytes: 1, blob_key: `editor-projects/${ME}/${p.id}/v-00000000-0000-4000-8000-0000000000ff.json.gz`,
        created_at: new Date().toISOString(),
      })
    }
    const res = await cut(p)
    expect(res.json()).toEqual({ number: 3 })
    const v3 = versionOf(p, 3)!
    expect(storage.objects.has(v3.blob_key)).toBe(true)
    expect(storage.puts.filter((k) => VERSION_KEY.test(k))).toHaveLength(2)
    expect(storage.deleted.filter((k) => VERSION_KEY.test(k))).toEqual([])
  })

  it("a row the database refuses by its checks deletes the file the cut wrote", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    db.versionInsertError = { code: "23514", message: "check constraint" }
    const res = await cut(p)
    expect(res.statusCode).toBe(500)
    const written = storage.puts.filter((k) => VERSION_KEY.test(k))
    expect(written).toHaveLength(1)
    expect(storage.deleted).toEqual(written)
    expect(db.versions).toEqual([])
  })

  it("an insert whose outcome is unknown keeps the file it wrote, and answers the version when it landed", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    db.versionInsertError = { code: "08006", message: "connection failure" }
    expect((await cut(p)).statusCode).toBe(500)
    const orphan = storage.puts.filter((k) => VERSION_KEY.test(k))
    expect(orphan).toHaveLength(1)
    expect(storage.deleted).toEqual([])
    expect(storage.objects.has(orphan[0]!)).toBe(true)
    // Landed, but the answer was lost: the row names the file, so it is the version.
    db.versionInsertErrorAfterCommit = { code: "08006", message: "connection failure" }
    const landed = await cut(p)
    expect(landed.statusCode, landed.body).toBe(200)
    expect(landed.json()).toEqual({ number: 1 })
    expect(storage.objects.has(versionOf(p, 1)!.blob_key)).toBe(true)
  })

  it("a failed write of the version's file answers 500 and creates no row", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    storage.failPut = (k) => VERSION_KEY.test(k)
    expect((await cut(p)).statusCode).toBe(500)
    expect(db.versions).toEqual([])
  })

  it("a saved file whose content is not the row's hash is never cut as a version", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    storage.objects.set(p.blob_key!, { body: gzipSync('{"a":2}') })
    expect((await cut(p)).statusCode).toBe(500)
    expect(db.versions).toEqual([])
  })
})

describe("thinning past 50 versions", () => {
  async function cutMany(p: ProjectRow, count: number, label = (i: number) => `Edit ${i}`, author = (_i: number) => "you") {
    for (let i = 1; i <= count; i++) {
      await saveWhole(p, { i, note: randomBytes(4).toString("hex") })
      await cutOk(p, label(i), author(i))
    }
  }

  it("the 51st version deletes the oldest unprotected one and its blob when nothing else references it", async () => {
    const p = heldProject()
    await cutMany(p, 50, (i) => (i === 2 ? "Exported" : `Edit ${i}`), (i) => (i === 1 ? "agent" : "you"))
    expect(db.versions).toHaveLength(50)
    const third = versionOf(p, 3)!
    storage.deleted = []
    db.versionWrites = []
    await saveWhole(p, { i: 51 })
    expect(await cutOk(p)).toBe(51)
    expect(db.versions).toHaveLength(50)
    expect(versionOf(p, 1)).toBeDefined()
    expect(versionOf(p, 2)).toBeDefined()
    expect(versionOf(p, 3)).toBeUndefined()
    expect(storage.deleted).toContain(third.blob_key)
    expect(storage.objects.has(third.blob_key)).toBe(false)
    // The row goes first, then its file.
    expect(db.versionWrites).toEqual(["insert 51", "delete 3"])
  })

  it("a blob shared by the working copy and a version survives the version's deletion", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { same: true })
    await cutOk(p)
    for (let i = 2; i <= 50; i++) {
      await saveWhole(p, { i })
      await cutOk(p)
    }
    // The working copy returns to version 1's content; version 51 is cut of it, and thinning drops version 1.
    await saveWhole(p, { same: true })
    const working = p.blob_key!
    const first = versionOf(p, 1)!
    expect(first.content_hash).toBe(e.hash)
    expect(await cutOk(p)).toBe(51)
    expect(versionOf(p, 1)).toBeUndefined()
    expect(storage.deleted).toContain(first.blob_key)
    expect(storage.deleted).not.toContain(working)
    expect(storage.objects.has(working)).toBe(true)
    expect((await readBack(p)).text).toBe(e.text)
    expect((await readVersion(p, 51)).text).toBe(e.text)
  })

  it("thinning keeps a full version that a kept patch needs", async () => {
    const p = heldProject()
    const base = bigProject()
    await saveWhole(p, base)
    await cutOk(p)
    // An agent's patch on version 1.
    await saveWhole(p, { ...base, title: "Agent" })
    await cutOk(p, "Tightened", "agent")
    expect(versionOf(p, 2)).toMatchObject({ kind: "patch", base_number: 1 })
    for (let i = 3; i <= 51; i++) {
      await saveWhole(p, { i, note: randomBytes(4).toString("hex") })
      await cutOk(p)
    }
    expect(db.versions).toHaveLength(50)
    expect(versionOf(p, 1)).toBeDefined()
    expect(versionOf(p, 2)).toBeDefined()
    expect(versionOf(p, 3)).toBeUndefined()
    expect((await readVersion(p, 2)).text).toBe(envelope({ ...base, title: "Agent" }).text)
  })

  it("a thinning that fails does not fail the cut", async () => {
    const p = heldProject()
    await cutMany(p, 50)
    await saveWhole(p, { i: 51 })
    db.versionDeleteError = { code: "08006", message: "connection failure" }
    expect(await cutOk(p)).toBe(51)
    expect(db.versions).toHaveLength(51)
    db.versionDeleteError = null
    // A failed file delete after the row's: the version is gone, its file an orphan.
    storage.failDelete = (k) => VERSION_KEY.test(k)
    await saveWhole(p, { i: 52 })
    expect(await cutOk(p)).toBe(52)
    expect(db.versions).toHaveLength(50)
  })
})

describe("reading a version", () => {
  it("answers the whole content as gzip with the project's revision and the version number", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    const v = await readVersion(p, 1)
    expect(v.status).toBe(200)
    expect(v.text).toBe(e1.text)
    expect(v.res.headers["content-type"]).toBe("application/gzip")
    expect(v.res.headers["cache-control"]).toBe("no-store")
    expect(v.res.headers["x-revision"]).toBe("2")
    expect(v.res.headers["x-version"]).toBe("1")
    expect(String(v.res.headers["access-control-expose-headers"]).toLowerCase()).toContain("x-version")
  })

  it("an unknown version is 404, a malformed one 400", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    expect((await readVersion(p, 1)).res.json()).toEqual({ error: "not_found" })
    for (const n of ["0", "-1", "1.5", "abc", "1e3", "0x10", "2147483648"]) expect((await readVersion(p, n)).status, n).toBe(400)
    expect((await json("GET", `/v1/editor-projects/${p.id}/file?other=1`)).statusCode).toBe(400)
  })

  it("a corrupted patch blob answers version_unreadable", async () => {
    const p = heldProject()
    const base = bigProject()
    await saveWhole(p, base)
    await cutOk(p)
    await saveWhole(p, { ...base, title: "Cut 2" })
    await cutOk(p)
    const v2 = versionOf(p, 2)!
    expect(v2.kind).toBe("patch")
    // A patch that applies cleanly but to other content.
    storage.objects.set(v2.blob_key, { body: gzipSync(JSON.stringify([{ op: "replace", path: "/title", value: "Cut 3" }])) })
    let read = await readVersion(p, 2)
    expect(read.status).toBe(500)
    expect(read.res.json()).toEqual({ error: "version_unreadable" })
    // Not gzip; a patch that does not apply; a missing file; a missing base.
    for (const body of [Buffer.from("plain"), gzipSync(JSON.stringify([{ op: "remove", path: "/nope" }]))]) {
      storage.objects.set(v2.blob_key, { body })
      read = await readVersion(p, 2)
      expect(read.res.json()).toEqual({ error: "version_unreadable" })
    }
    storage.objects.delete(v2.blob_key)
    expect((await readVersion(p, 2)).res.json()).toEqual({ error: "version_unreadable" })
    storage.objects.delete(versionOf(p, 1)!.blob_key)
    expect((await readVersion(p, 1)).res.json()).toEqual({ error: "version_unreadable" })
  })

  it("a full version whose file holds other content answers version_unreadable", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    storage.objects.set(versionOf(p, 1)!.blob_key, { body: gzipSync('{"a":9}') })
    expect((await readVersion(p, 1)).res.json()).toEqual({ error: "version_unreadable" })
  })

  it("GET /:id lists versions newest first: number, label, author, created_at, size_bytes, kind, and nothing else", async () => {
    const p = heldProject()
    const base = bigProject()
    await saveWhole(p, base)
    await cutOk(p, "First")
    await saveWhole(p, { ...base, title: "Second" })
    await cutOk(p, "Second", "agent")
    const res = await json("GET", `/v1/editor-projects/${p.id}`)
    const versions = res.json().versions as Array<Record<string, unknown>>
    expect(versions.map((v) => v.number)).toEqual([2, 1])
    for (const v of versions) expect(Object.keys(v).sort()).toEqual(["author", "created_at", "kind", "label", "number", "size_bytes"])
    expect(versions[0]).toMatchObject({ label: "Second", author: "agent", kind: "patch" })
    expect(res.body).not.toContain("blob_key")
    expect(res.body).not.toContain(p.content_hash!)
  })
})

describe("x-cut-version on a save", () => {
  it("a PUT and a PATCH with x-cut-version answer the version they cut; none when unchanged", async () => {
    const p = heldProject()
    const e1 = envelope({ a: 1 })
    let res = await putFile(p.id, e1.gz, e1.hash, { "x-cut-version": encodeURIComponent("Rough cut — v1") })
    expect(res.json()).toEqual({ revision: 1, saved: true, version: 1 })
    expect(versionOf(p, 1)).toMatchObject({ label: "Rough cut — v1", author: "you", content_hash: e1.hash })
    // The same content again: saved: false, and no new version.
    res = await putFile(p.id, e1.gz, e1.hash, { "x-cut-version": "Again" })
    expect(res.json()).toEqual({ revision: 1, saved: false })
    const e2 = envelope({ a: 2 })
    res = await patchFile(p.id, jsonpatch.compare({ a: 1 }, { a: 2 }), e1.hash, e2.hash, { "x-cut-version": "Patched" })
    expect(res.json()).toEqual({ revision: 2, saved: true, version: 2 })
    expect(versionOf(p, 2)).toMatchObject({ label: "Patched", content_hash: e2.hash })
  })

  it("a save whose content is newer than the last version cuts one even when the save itself changed nothing", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    const res = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "Exported" })
    expect(res.json()).toEqual({ revision: 1, saved: false, version: 1 })
  })

  it("a failure to cut the version never fails the save", async () => {
    const p = heldProject()
    storage.failPut = (k) => VERSION_KEY.test(k)
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "Rough cut" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: true })
    expect(savedText(p)).toBe(e.text)
    expect(db.versions).toEqual([])
  })
})

describe("restoring a version", () => {
  it("restore cuts Before restore, then the file route serves version n's bytes", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p, "First")
    const e2 = await saveWhole(p, { a: 2 })
    const replaced = p.blob_key!
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3 })
    // The state it replaced is a version, and readable.
    expect(versionOf(p, 2)).toMatchObject({ label: "Before restore", author: "you", content_hash: e2.hash })
    expect((await readVersion(p, 2)).text).toBe(e2.text)
    // The project's content is version 1's, under a new key; the replaced file is gone.
    expect(p.content_hash).toBe(e1.hash)
    expect(p.blob_key).not.toBe(replaced)
    expect(p.blob_key).not.toBe(versionOf(p, 1)!.blob_key)
    expect(storage.deleted).toContain(replaced)
    const back = await readBack(p)
    expect(back).toMatchObject({ status: 200, revision: "3", text: e1.text })
    // Version 1 is untouched.
    expect((await readVersion(p, 1)).text).toBe(e1.text)
  })

  it("restoring a version cut of the current state cuts nothing and changes nothing", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    const res = await restore(p, 1)
    expect(res.json()).toEqual({ revision: 1, unchanged: true })
    expect(db.versions).toHaveLength(1)
    expect(p.revision).toBe(1)
  })

  it("does not cut Before restore again when the current state is already the newest version", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    await cutOk(p)
    expect((await restore(p, 1)).json()).toEqual({ revision: 3 })
    expect(db.versions.map((v) => v.label)).toEqual(["Manual edit", "Manual edit"])
    expect(p.content_hash).toBe(e1.hash)
  })

  it("needs the holder, a known version and a saved project", async () => {
    const p = heldProject()
    expect((await restore(p, 1)).json()).toEqual({ error: "not_found" })
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    expect((await restore(p, 1, TAB2)).json()).toEqual({ error: "not_holder" })
    expect((await restore(p, 1, "short")).json()).toEqual({ error: "invalid_holder" })
    expect((await restore(p, 9)).json()).toEqual({ error: "not_found" })
    for (const n of ["abc", "0", "1e0", "0x1"]) {
      expect((await json("POST", `/v1/editor-projects/${p.id}/versions/${n}/restore`, { holder: TAB })).statusCode, n).toBe(400)
    }
    expect(db.versions).toHaveLength(1)
    expect(p.revision).toBe(2)
  })

  it("a restore whose Before restore cut fails changes nothing", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    const e2 = await saveWhole(p, { a: 2 })
    storage.failPut = (k) => VERSION_KEY.test(k)
    expect((await restore(p, 1)).statusCode).toBe(500)
    expect(p.content_hash).toBe(e2.hash)
    expect(p.revision).toBe(2)
  })

  it("a save landing during a restore is never overwritten: the restore is refused base_mismatch", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    const e3 = envelope({ a: 3 })
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        expect((await putFile(p.id, e3.gz, e3.hash)).statusCode).toBe(200)
      })
    }
    const res = await restore(p, 1)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "base_mismatch" })
    expect(p.content_hash).toBe(e3.hash)
    expect(savedText(p)).toBe(e3.text)
  })

  it("an unreadable version is refused before anything is cut or saved", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    storage.objects.delete(versionOf(p, 1)!.blob_key)
    expect((await restore(p, 1)).json()).toEqual({ error: "version_unreadable" })
    expect(db.versions).toHaveLength(1)
    expect(p.revision).toBe(2)
  })

  it("restores the oldest version even when the Before restore cut thins it", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { first: true })
    await cutOk(p)
    for (let i = 2; i <= 50; i++) {
      await saveWhole(p, { i })
      await cutOk(p)
    }
    await saveWhole(p, { current: true })
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(versionOf(p, 1)).toBeUndefined()
    expect(versionOf(p, 51)).toMatchObject({ label: "Before restore" })
    expect((await readBack(p)).text).toBe(e1.text)
  })
})

describe("a restore at the cap", () => {
  /** 50 versions, version 1 the oldest of the person's own; the project then moves on. */
  async function atTheCap() {
    const p = heldProject()
    const e1 = await saveWhole(p, { first: true })
    await cutOk(p)
    for (let i = 2; i <= 50; i++) {
      await saveWhole(p, { i })
      await cutOk(p)
    }
    await saveWhole(p, { current: true })
    return { p, e1 }
  }

  it("a restore refused because a save landed meanwhile keeps version n", async () => {
    const { p, e1 } = await atTheCap()
    const e3 = envelope({ landed: true })
    db.beforeSave = async () => {
      // The same user, acting from another instance (each instance runs one heavy request per user).
      await onAnotherInstance(async () => {
        expect((await putFile(p.id, e3.gz, e3.hash)).statusCode).toBe(200)
      })
    }
    const res = await restore(p, 1)
    expect(res.json()).toEqual({ error: "base_mismatch" })
    expect(p.content_hash).toBe(e3.hash)
    expect(versionOf(p, 1)).toBeDefined()
    expect((await readVersion(p, 1)).text).toBe(e1.text)
    // The state it would have replaced is kept too.
    expect(versionOf(p, 51)).toMatchObject({ label: "Before restore" })
  })

  it("a restore whose save fails at storage keeps version n", async () => {
    const { p, e1 } = await atTheCap()
    storage.failPut = (k) => !VERSION_KEY.test(k)
    expect((await restore(p, 1)).statusCode).toBe(500)
    storage.failPut = null
    expect(versionOf(p, 1)).toBeDefined()
    expect((await readVersion(p, 1)).text).toBe(e1.text)
    // A later cut thins as usual.
    await saveWhole(p, { later: true })
    await cutOk(p)
    expect(db.versions).toHaveLength(50)
  })
})

describe("more cut and restore outcomes", () => {
  it("a second taken number fails the cut and deletes the file it wrote", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    const racer = (n: number) => ({
      id: `racer-${n}`, project_id: p.id, number: n, label: "Racer", author: "you", kind: "full" as const, base_number: null,
      content_hash: sha(`racer-${n}`), size_bytes: 1, blob_key: `editor-projects/${ME}/${p.id}/v-00000000-0000-4000-8000-0000000000${n}f.json.gz`,
      created_at: new Date().toISOString(),
    })
    db.beforeVersionInsert = () => {
      db.versions.push(racer(2))
      db.beforeVersionInsert = () => void db.versions.push(racer(3))
    }
    expect((await cut(p)).statusCode).toBe(500)
    const written = storage.puts.filter((k) => VERSION_KEY.test(k)).slice(-1)
    expect(storage.deleted).toEqual(expect.arrayContaining(written))
    expect(storage.objects.has(written[0]!)).toBe(false)
    expect(db.versions.map((v) => v.number)).toEqual([1, 2, 3])
  })

  it("a restore whose save landed but whose answer was lost: the project reads the restored content, nothing deleted", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    const replaced = p.blob_key!
    storage.deleted = []
    db.saveErrorAfterCommit = { code: "08006", message: "connection failure" }
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3 })
    expect((await readBack(p)).text).toBe(e1.text)
    expect(storage.deleted).toEqual([])
    expect(storage.objects.has(replaced)).toBe(true)
  })

  it("a restore of a project whose own file is missing repairs it, with no Before restore", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    storage.objects.delete(p.blob_key!)
    expect((await readBack(p)).status).toBe(500)
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect(db.versions).toHaveLength(1)
    expect((await readBack(p)).text).toBe(e1.text)
    expect(storage.objects.has(p.blob_key!)).toBe(true)
  })

  it("a restore of a project whose current file is present but unreadable repairs it and keeps that file", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    const corrupt = p.blob_key!
    storage.objects.set(corrupt, { body: gzipSync('{"not":"the saved content"}') })
    storage.deleted = []
    const res = await restore(p, 1)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect(db.versions).toHaveLength(1)
    expect((await readBack(p)).text).toBe(e1.text)
    // The bytes it could not account for stay in storage.
    expect(storage.objects.has(corrupt)).toBe(true)
    expect(storage.deleted).toEqual([])
    // Not gzip at all: the same.
    const again = heldProject()
    await saveWhole(again, { b: 1 })
    await cutOk(again)
    await saveWhole(again, { b: 2 })
    const broken = again.blob_key!
    storage.objects.set(broken, { body: Buffer.from("not gzip") })
    expect((await restore(again, 1)).json()).toMatchObject({ repaired: true })
    expect(storage.objects.has(broken)).toBe(true)
  })

  it("a restore whose current state is already the newest version, but whose file is gone, says repaired", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    await cutOk(p)
    storage.objects.delete(p.blob_key!)
    const res = await restore(p, 1)
    expect(res.json()).toEqual({ revision: 3, repaired: true })
    expect((await readBack(p)).text).toBe(e1.text)
    // A healthy file in the same position: a plain answer.
    const q = heldProject()
    await saveWhole(q, { c: 1 })
    await cutOk(q)
    await saveWhole(q, { c: 2 })
    await cutOk(q)
    expect((await restore(q, 1)).json()).toEqual({ revision: 3 })
  })

  it("x-cut-version cuts the save's own content: none when the project moved on before the cut", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const other = envelope({ other: true })
    db.afterSave = () => {
      // Another save lands between this save and its cut.
      const key = `editor-projects/${ME}/${p.id}/00000000-0000-4000-8000-0000000000c1.json.gz`
      storage.objects.set(key, { body: other.gz })
      Object.assign(p, { content_hash: other.hash, blob_key: key, revision: p.revision + 1 })
    }
    const res = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "Mine" })
    expect(res.statusCode).toBe(200)
    expect(res.json().saved).toBe(true)
    expect(res.json()).not.toHaveProperty("version")
    expect(db.versions).toEqual([])
  })

  it("x-cut-version labels are trimmed: a blank one is 400, Exported with a space is Exported", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const blank = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "%20%20" })
    expect(blank.statusCode).toBe(400)
    expect(blank.json()).toEqual({ error: "validation_error" })
    const res = await putFile(p.id, e.gz, e.hash, { "x-cut-version": "Exported%20" })
    expect(res.json()).toEqual({ revision: 1, saved: true, version: 1 })
    expect(versionOf(p, 1)!.label).toBe("Exported")
  })

  it("x-cut-version on a PATCH retried after it landed (saved: false after a base mismatch) cuts that content", async () => {
    const p = heldProject()
    const e1 = await saveWhole(p, { a: 1 })
    const e2 = envelope({ a: 2 })
    const ops = jsonpatch.compare({ a: 1 }, { a: 2 })
    expect((await patchFile(p.id, ops, e1.hash, e2.hash)).json()).toEqual({ revision: 2, saved: true })
    const retry = await patchFile(p.id, ops, e1.hash, e2.hash, { "x-cut-version": "Retry" })
    expect(retry.json()).toEqual({ revision: 2, saved: false, version: 1 })
    expect(versionOf(p, 1)).toMatchObject({ label: "Retry", content_hash: e2.hash })
  })
})

describe("deleting a project with versions", () => {
  it("deletes every version's file with the project's own", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    await cutOk(p)
    await saveWhole(p, { a: 2 })
    await cutOk(p)
    const versionKeys = db.versions.map((v) => v.blob_key)
    const res = await json("DELETE", `/v1/editor-projects/${p.id}`)
    expect(res.statusCode).toBe(200)
    for (const key of versionKeys) expect(storage.deleted).toContain(key)
    expect(keysOf(p)).toEqual([])
  })

  it("another user's project answers 404 on the version routes", async () => {
    const theirs = seedProject({ user_id: OTHER, holder_id: TAB, holder_seen_at: new Date().toISOString(), content_hash: sha("x") })
    expect((await cut(theirs)).json()).toEqual({ error: "not_found" })
    expect((await restore(theirs, 1)).json()).toEqual({ error: "not_found" })
    expect((await readVersion(theirs, 1)).res.json()).toEqual({ error: "not_found" })
    theirs.blob_key = `editor-projects/${OTHER}/${theirs.id}/00000000-0000-4000-8000-0000000000d1.json.gz`
    storage.objects.set(theirs.blob_key, { body: gzipSync("{}") })
    expect((await json("DELETE", `/v1/editor-projects/${theirs.id}`)).json()).toEqual({ error: "not_found" })
    expect(storage.deleted).toEqual([])
    expect(storage.objects.has(theirs.blob_key)).toBe(true)
    expect(theirs.deleted_at).toBeNull()
  })
})
