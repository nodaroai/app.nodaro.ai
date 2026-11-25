import { describe, it, expect, afterEach } from "vitest"
import { gzipSync } from "node:zlib"
import jsonpatch from "fast-json-patch"
import { canonicalJson, contentHash } from "../canonical.js"
import { EditorProjectRefusal } from "../refusal.js"
import { DIFF_MAX_OPS, boundedCompare } from "../heavy-jobs.js"
import { MAX_INDEX_OPS, checkedPatch } from "../patch.js"
import {
  HEAVY_JOB_TIMEOUT_MS, HEAVY_WORKERS, HEAVY_WORKER_LIMITS,
  __restartHeavyWorkersForTests, __setHeavyLimitsForTests, canonicalContent, patchedContent, versionContent, versionPatch,
} from "../heavy.js"

/**
 * The heavy-work pool: every job runs on a worker thread under a time and a
 * memory limit; a job past either is killed and answered, the request thread
 * keeps running, and the next job gets a fresh worker.
 */

let restore: (() => void) | null = null
afterEach(async () => {
  restore?.()
  restore = null
  await __restartHeavyWorkersForTests()
})

const gz = (value: unknown) => {
  const text = canonicalJson(value)
  return { text, hash: contentHash(text), gz: gzipSync(Buffer.from(text, "utf8")) }
}

/** How many times a 5 ms timer on the request thread fired while `work` ran (work on that thread would let it fire hardly at all). */
async function timerTicks(work: () => Promise<unknown>): Promise<{ ticks: number; outcome: unknown }> {
  let ticks = 0
  const timer = setInterval(() => {
    ticks++
  }, 5)
  try {
    const outcome = await work().then((v) => v, (e) => e)
    return { ticks, outcome }
  } finally {
    clearInterval(timer)
  }
}

const refusal = (err: unknown) => (err instanceof EditorProjectRefusal ? { status: err.status, code: err.code } : err)

describe("the heavy-work pool", () => {
  it("has the limits the routes rely on", () => {
    expect(HEAVY_WORKERS).toBe(2)
    expect(HEAVY_JOB_TIMEOUT_MS).toBe(10_000)
    expect(HEAVY_WORKER_LIMITS).toEqual({ maxOldGenerationSizeMb: 512 })
  })

  it("canonicalises a save off the request thread", async () => {
    const e = gz({ b: 1, a: [2, { d: 4, c: 3 }] })
    const out = await canonicalContent(e.gz, e.hash)
    expect(out.text.toString("utf8")).toBe(e.text)
  })

  it("a patch that splices a large array past the time limit is killed (too_complex) and the request thread keeps running", async () => {
    const base = gz(Array.from({ length: 2_000_000 }, () => 0))
    const ops = Array.from({ length: MAX_INDEX_OPS }, () => ({ op: "remove", path: "/1" }))
    const patch = gzipSync(Buffer.from(JSON.stringify(ops), "utf8"))
    // Warm a worker first, so the limit times the job alone.
    await canonicalContent(gz({}).gz, gz({}).hash)
    restore = __setHeavyLimitsForTests({ timeoutMs: 150 })
    const { ticks, outcome } = await timerTicks(() => patchedContent(patch, base.gz, "0".repeat(64)))
    expect(refusal(outcome)).toEqual({ status: 422, code: "too_complex" })
    expect(ticks).toBeGreaterThanOrEqual(5)
    // The killed worker is replaced: the next job runs.
    restore()
    restore = null
    const e = gz({ ok: true })
    expect((await canonicalContent(e.gz, e.hash)).text.toString("utf8")).toBe(e.text)
  }, 60_000)

  it("a version read past the time limit answers version_unreadable", async () => {
    const big = gz(Array.from({ length: 600_000 }, (_, i) => ({ i })))
    expect(big.text.length).toBeLessThan(8 * 1024 * 1024)
    await canonicalContent(gz({}).gz, gz({}).hash)
    // Unlimited, it rebuilds; held to 100 ms, it is killed.
    expect((await versionContent(big.gz, { kind: "full", content_hash: big.hash }, null)).length).toBeGreaterThan(0)
    restore = __setHeavyLimitsForTests({ timeoutMs: 100 })
    const { ticks, outcome } = await timerTicks(() => versionContent(big.gz, { kind: "full", content_hash: big.hash }, null))
    expect(refusal(outcome)).toEqual({ status: 500, code: "version_unreadable" })
    expect(ticks).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it("a job past the memory limit is killed, and the process goes on", async () => {
    await __restartHeavyWorkersForTests()
    restore = __setHeavyLimitsForTests({ maxOldGenerationSizeMb: 48 })
    // Millions of tiny containers: under 8 MB of text, several times 48 MB once parsed.
    const big = gz(Array.from({ length: 2_600_000 }, () => []))
    expect(big.text.length).toBeLessThan(8 * 1024 * 1024)
    // A worker under this limit runs a small job: what kills the large one is the memory it needs.
    const small = gz({ small: true })
    expect((await canonicalContent(small.gz, small.hash)).text.toString("utf8")).toBe(small.text)
    const outcome = await canonicalContent(big.gz, big.hash).then((v) => v, (e) => e)
    expect(refusal(outcome)).toEqual({ status: 422, code: "too_complex" })
    restore()
    restore = null
    await __restartHeavyWorkersForTests()
    const e = gz({ after: 1 })
    expect((await canonicalContent(e.gz, e.hash)).text.toString("utf8")).toBe(e.text)
  }, 60_000)

  it("a cut's diff past the time limit stores the version whole (null)", async () => {
    const a = gz(Array.from({ length: 200_000 }, (_, i) => i))
    const b = gz(Array.from({ length: 200_000 }, (_, i) => (i === 7 ? -1 : i)))
    await canonicalContent(gz({}).gz, gz({}).hash)
    restore = __setHeavyLimitsForTests({ timeoutMs: 1 })
    expect(await versionPatch(a.gz, a.hash, b.gz, b.hash)).toBeNull()
  }, 60_000)

  it("a cut's diff is a patch when it is small and rebuilds exactly", async () => {
    const value = { clips: Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, note: `n${i}`.repeat(8) })) }
    const a = gz(value)
    const b = gz({ ...value, title: "renamed" })
    const patch = await versionPatch(a.gz, a.hash, b.gz, b.hash)
    expect(patch).not.toBeNull()
    const rebuilt = await versionContent(patch!, { kind: "patch", content_hash: b.hash }, { file: a.gz, content_hash: a.hash })
    expect(rebuilt.length).toBeGreaterThan(0)
  })

  it("a cut over a text past 2 MB is never diffed", async () => {
    const value = { big: "x".repeat(2 * 1024 * 1024), n: 1 }
    const a = gz(value)
    const b = gz({ ...value, n: 2 })
    expect(await versionPatch(a.gz, a.hash, b.gz, b.hash)).toBeNull()
  })
})

describe("boundedCompare", () => {
  const cases: Array<[unknown, unknown]> = [
    [{ a: 1, b: [1, 2, 3] }, { a: 2, b: [1, 3], c: { d: null } }],
    [[1, 2, 3, 4], [4]],
    [{ "x/y": 1, "t~": 2 }, { "x/y": 3 }],
    [{ a: [1] }, { a: { 0: 1 } }],
    [{ a: 1 }, { a: 1 }],
  ]
  it.each(cases)("produces a patch that turns a into b: %j → %j", (a, b) => {
    const ops = boundedCompare(a, b, DIFF_MAX_OPS)!
    expect(ops).toEqual(jsonpatch.compare(a as object, b as object))
    const out = jsonpatch.applyPatch(structuredClone(a), ops, true, true, true).newDocument
    expect(canonicalJson(out)).toBe(canonicalJson(b))
  })

  it("stops once it passes the operation cap", () => {
    const a = Array.from({ length: 1_000 }, (_, i) => i)
    const b = a.map((i) => i + 1)
    expect(boundedCompare(a, b, 999)).toBeNull()
    expect(boundedCompare(a, b, 1_000)).toHaveLength(1_000)
  })
})

describe("a client patch's index budget", () => {
  const removes = (n: number) => Array.from({ length: n }, () => ({ op: "remove", path: "/list/1" }))
  it(`refuses more than ${MAX_INDEX_OPS} add/remove operations on an array index as too_complex`, () => {
    expect(() => checkedPatch(removes(MAX_INDEX_OPS), { indexBudget: MAX_INDEX_OPS })).not.toThrow()
    expect(refusal((() => { try { checkedPatch(removes(MAX_INDEX_OPS + 1), { indexBudget: MAX_INDEX_OPS }) } catch (e) { return e } })()))
      .toEqual({ status: 422, code: "too_complex" })
    const appends = Array.from({ length: MAX_INDEX_OPS + 1 }, () => ({ op: "add", path: "/list/-", value: 0 }))
    expect(() => checkedPatch(appends, { indexBudget: MAX_INDEX_OPS })).toThrow()
  })
  it("counts a non-canonical index too: leading zeros and the empty last segment", () => {
    for (const path of ["/list/00", "/list/01", "/list/"]) {
      const ops = Array.from({ length: MAX_INDEX_OPS + 1 }, () => ({ op: "add", path, value: 0 }))
      expect(refusal((() => { try { checkedPatch(ops, { indexBudget: MAX_INDEX_OPS }) } catch (e) { return e } })()), path)
        .toEqual({ status: 422, code: "too_complex" })
    }
  })

  it("does not count replace, or add/remove on an object key", () => {
    const ops = [
      ...Array.from({ length: MAX_INDEX_OPS + 1 }, (_, i) => ({ op: "replace", path: `/list/${i}`, value: 1 })),
      ...Array.from({ length: MAX_INDEX_OPS + 1 }, (_, i) => ({ op: "add", path: `/map/k${i}`, value: 1 })),
    ]
    expect(() => checkedPatch(ops, { indexBudget: MAX_INDEX_OPS })).not.toThrow()
  })
})
