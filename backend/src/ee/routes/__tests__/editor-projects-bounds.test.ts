import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { randomBytes } from "node:crypto"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import { db, seedProject, storage, type ProjectRow } from "./editor-projects-fakes.js"
import { MAX_INDEX_OPS } from "../../lib/editor-projects/patch.js"
import { PROJECT_TEXT_MAX_BYTES } from "../../lib/editor-projects/store.js"
import { __heavyJobsStartedForTests as jobs, __restartHeavyWorkersForTests, __setHeavyLimitsForTests } from "../../lib/editor-projects/heavy.js"
import {
  MB, OTHER, TAB2, envelope, heldProject, json, keysOf, patchFile, putFile, saveWhole, sha, startApp, stopApp,
} from "./editor-projects-harness.js"

/**
 * The bounds on what one request can cost the instance it runs on: the
 * content cap, the client patch's index budget, ownership checked before any
 * heavy work, and the time limit on the heavy work itself (the request thread
 * keeps serving while a job runs, and a job past its limit is answered).
 */

let restoreLimits: (() => void) | null = null
beforeEach(startApp)
afterEach(async () => {
  restoreLimits?.()
  restoreLimits = null
  await __restartHeavyWorkersForTests()
  await stopApp()
})

/**
 * How many times a 5 ms timer on the request thread fired while `work` ran.
 * Work on the request thread itself would let it fire hardly at all.
 */
async function timerTicks<T>(work: () => Promise<T>): Promise<{ ticks: number; value: T }> {
  let ticks = 0
  const timer = setInterval(() => {
    ticks++
  }, 5)
  try {
    const value = await work()
    return { ticks, value }
  } finally {
    clearInterval(timer)
  }
}

const cut = (p: ProjectRow) => json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "Manual edit", author: "you", holder: "tab-aaaa-1111" })
const versionOf = (p: ProjectRow, n: number) => db.versions.find((v) => v.project_id === p.id && v.number === n)

describe("the content cap", () => {
  it(`is ${PROJECT_TEXT_MAX_BYTES / MB} MB of canonical text`, () => {
    expect(PROJECT_TEXT_MAX_BYTES).toBe(8 * MB)
  })

  it("a whole save whose canonical text is over the cap is 413 too_large and stores nothing", async () => {
    const p = heldProject()
    const e = envelope({ s: "x".repeat(8 * MB) })
    expect(e.gz.length).toBeLessThan(MB)
    const res = await putFile(p.id, e.gz, e.hash)
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: "too_large" })
    expect(keysOf(p)).toEqual([])
  })

  it("a patch whose result is over the cap is 413 too_large", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: "x".repeat(4 * MB) })
    const ops = [{ op: "add", path: "/b", value: randomBytes(3 * MB).toString("base64") }]
    const res = await patchFile(p.id, ops, base.hash, sha("anything"))
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: "too_large" })
  })
})

describe("a client patch's index budget", () => {
  it(`more than ${MAX_INDEX_OPS} add/remove operations on an array index is 422 too_complex, before anything is applied`, async () => {
    const p = heldProject()
    const base = await saveWhole(p, { list: Array.from({ length: MAX_INDEX_OPS + 10 }, (_, i) => i) })
    const ops = Array.from({ length: MAX_INDEX_OPS + 1 }, () => ({ op: "remove", path: "/list/0" }))
    const res = await patchFile(p.id, ops, base.hash, sha("anything"))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "too_complex" })
    expect(keysOf(p)).toEqual([p.blob_key])
  })

  it("a non-canonical index (/list/00, /list/) counts too, and is refused before the saved content is inflated", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { list: [1, 2, 3] })
    // The saved file is unreadable: a refusal that reached it would be another one.
    storage.objects.set(p.blob_key!, { body: Buffer.from("not gzip") })
    for (const path of ["/list/00", "/list/"]) {
      const ops = Array.from({ length: MAX_INDEX_OPS + 1 }, () => ({ op: "add", path, value: 0 }))
      const res = await patchFile(p.id, ops, base.hash, sha("anything"))
      expect(res.statusCode, path).toBe(422)
      expect(res.json(), path).toEqual({ error: "too_complex" })
    }
  })

  it(`${MAX_INDEX_OPS} of them still apply`, async () => {
    const p = heldProject()
    const list = Array.from({ length: MAX_INDEX_OPS + 10 }, (_, i) => i)
    const base = await saveWhole(p, { list })
    const next = envelope({ list: list.slice(MAX_INDEX_OPS) })
    const ops = Array.from({ length: MAX_INDEX_OPS }, () => ({ op: "remove", path: "/list/0" }))
    const res = await patchFile(p.id, ops, base.hash, next.hash)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
  })
})

describe("ownership before any heavy work", () => {
  it("a save to a project that does not exist, is another person's, or is not held by this tab does no heavy work", async () => {
    const mine = heldProject()
    const theirs = seedProject({ user_id: OTHER, holder_id: "tab-aaaa-1111", holder_seen_at: new Date().toISOString() })
    const notHeld = heldProject({ holder_id: TAB2 })
    const e = envelope({ a: 1 })
    const before = { content: jobs("content"), patch: jobs("patch") }
    const missing = await putFile("00000000-0000-4000-8000-0000000000ff", e.gz, e.hash)
    expect(missing.statusCode).toBe(404)
    expect((await putFile(theirs.id, e.gz, e.hash)).statusCode).toBe(404)
    expect((await putFile(notHeld.id, e.gz, e.hash)).json()).toEqual({ error: "not_holder" })
    expect((await patchFile(theirs.id, [], sha("x"), e.hash)).statusCode).toBe(404)
    expect((await patchFile(notHeld.id, [], sha("x"), e.hash)).json()).toEqual({ error: "not_holder" })
    expect({ content: jobs("content"), patch: jobs("patch") }).toEqual(before)
    expect(mine.revision).toBe(0)
  })
})

describe("heavy work past its time limit", () => {
  it("a PATCH that would splice a large array for seconds is refused 422 too_complex, and the request thread keeps serving", async () => {
    const p = heldProject()
    const base = await saveWhole(p, Array.from({ length: 2_000_000 }, () => 0))
    const ops = Array.from({ length: MAX_INDEX_OPS }, () => ({ op: "remove", path: "/1" }))
    restoreLimits = __setHeavyLimitsForTests({ timeoutMs: 150 })
    const { ticks, value: res } = await timerTicks(() => patchFile(p.id, ops, base.hash, sha("anything")))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: "too_complex" })
    expect(ticks).toBeGreaterThanOrEqual(5)
    expect(keysOf(p)).toEqual([p.blob_key])
    // The worker was replaced: the next save works.
    restoreLimits()
    restoreLimits = null
    await saveWhole(p, { after: true })
  }, 60_000)

  it("a version read past the limit is 500 version_unreadable, and the request thread keeps serving", async () => {
    const p = heldProject()
    await saveWhole(p, Array.from({ length: 600_000 }, (_, i) => ({ i })))
    expect((await cut(p)).json()).toEqual({ number: 1 })
    // Only the rebuild is held to the short limit.
    restoreLimits = __setHeavyLimitsForTests({ timeoutMsByKind: { version: 100 } })
    const { ticks, value: res } = await timerTicks(() => json("GET", `/v1/editor-projects/${p.id}/file?version=1`))
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "version_unreadable" })
    expect(ticks).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it("a cut whose diff is past the limit stores the version whole, without diffing again", async () => {
    const p = heldProject()
    const clips = Array.from({ length: 20_000 }, (_, i) => ({ id: `clip-${i}`, note: randomBytes(12).toString("hex") }))
    await saveWhole(p, { title: "a", clips })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    await saveWhole(p, { title: "b", clips })
    const diffs = jobs("diff")
    restoreLimits = __setHeavyLimitsForTests({ timeoutMsByKind: { diff: 1 } })
    const res = await cut(p)
    expect(res.json()).toEqual({ number: 2 })
    expect(versionOf(p, 2)).toMatchObject({ kind: "full", base_number: null })
    expect(jobs("diff") - diffs).toBe(1)
    restoreLimits()
    restoreLimits = null
    const read = await json("GET", `/v1/editor-projects/${p.id}/file?version=2`)
    expect(read.statusCode).toBe(200)
  }, 60_000)
})

describe("a cut's diff", () => {
  it("is not attempted when a text is over 2 MB: the version is stored whole", async () => {
    const p = heldProject()
    const big = randomBytes(1_600_000).toString("hex")
    await saveWhole(p, { big, n: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    await saveWhole(p, { big, n: 2 })
    const diffs = jobs("diff")
    expect((await cut(p)).json()).toEqual({ number: 2 })
    expect(versionOf(p, 2)).toMatchObject({ kind: "full" })
    expect(jobs("diff")).toBe(diffs)
  })

  it("under 2 MB, a small change is still stored as a patch", async () => {
    const p = heldProject()
    const clips = Array.from({ length: 400 }, (_, i) => ({ id: `clip-${i}`, note: randomBytes(12).toString("hex") }))
    await saveWhole(p, { title: "a", clips })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    await saveWhole(p, { title: "b", clips })
    expect((await cut(p)).json()).toEqual({ number: 2 })
    expect(versionOf(p, 2)).toMatchObject({ kind: "patch", base_number: 1 })
  })
})

describe("a heavy-work thread that fails other than by a limit", () => {
  it("one that cannot start, or dies mid-job, fails the save as a server error, never too_complex", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    for (const source of [
      `throw new Error("cannot start")`,
      `const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ ready: true }); parentPort.on("message", () => process.exit(3))`,
    ]) {
      await __restartHeavyWorkersForTests()
      restoreLimits = __setHeavyLimitsForTests({ workerSource: source })
      const res = await putFile(p.id, e.gz, e.hash)
      expect(res.statusCode, source).toBe(500)
      expect(res.json().error, source).not.toBe("too_complex")
      restoreLimits()
      restoreLimits = null
    }
    await __restartHeavyWorkersForTests()
    expect((await putFile(p.id, e.gz, e.hash)).json()).toEqual({ revision: 1, saved: true })
  }, 60_000)
})
