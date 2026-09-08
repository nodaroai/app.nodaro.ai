import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import IORedis from "ioredis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createStageJournal } from "../stage-journal.js"
import type { PluginStageKey } from "../scene3d-contract.js"

const key = (): PluginStageKey => ({ jobId: randomUUID(), userId: randomUUID(), attemptIndex: 0,
  stage: "planning", inputHash: "a".repeat(64), engineVersion: "1.0.0" })

describe("stage journal admission", () => {
  it("authorizes every operation, including a completed replay", async () => {
    const redis = { eval: vi.fn() }
    const journal = createStageJournal(redis, async () => { throw new Error("unavailable") })
    await expect(journal.claim(key(), 1000)).rejects.toThrow("unavailable")
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it("rejects malformed scope, unbounded leases and oversized records before storage", async () => {
    const redis = { eval: vi.fn() }
    const authorize = vi.fn()
    const journal = createStageJournal(redis, authorize)
    await expect(journal.claim({ ...key(), stage: "../../escape" }, 1000)).rejects.toThrow()
    await expect(journal.claim(key(), 999)).rejects.toThrow("Invalid stage lease")
    await expect(journal.claim(key(), 120001)).rejects.toThrow("Invalid stage lease")
    await expect(journal.complete(key(), { token: randomUUID(), fence: 1, expiresAt: Date.now() },
      { mesh: "x".repeat(65 * 1024) })).rejects.toThrow("size limit")
    expect(redis.eval).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
  })
})

// Run against an isolated real Redis when the binary is installed. No production
// REDIS_URL is read; the test process has no TCP listener and owns its directory.
const hasRedis = spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0
describe.skipIf(!hasRedis)("stage journal Redis concurrency and recovery", () => {
  let directory: string
  let child: ChildProcess
  let redis: IORedis

  async function start() {
    child = spawn("redis-server", ["--port", "0", "--unixsocket", path.join(directory, "redis.sock"),
      "--dir", directory, "--save", "", "--appendonly", "yes", "--appendfsync", "always"], { stdio: "ignore" })
    redis = new IORedis(path.join(directory, "redis.sock"), { retryStrategy: (attempt) => attempt < 40 ? 50 : null })
    redis.on("error", () => { /* Socket may not exist until Redis has started. */ })
    await new Promise<void>((resolve, reject) => {
      redis.once("ready", resolve)
      redis.once("end", () => reject(new Error("Test Redis did not start")))
      child.once("error", reject)
    })
  }
  async function stop() {
    redis.disconnect()
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    child.kill("SIGTERM")
    await exited
  }
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "stage-journal-")); await start() })
  afterAll(async () => { if (child?.exitCode === null) await stop(); if (directory) await rm(directory, { recursive: true, force: true }) })

  it("admits only one owner and replays committed output without starting work", async () => {
    const journal = createStageJournal(redis, async () => {})
    const stage = key()
    const claims = await Promise.all(Array.from({ length: 12 }, () => journal.claim(stage, 1000)))
    expect(claims.filter((value) => value.status === "claimed")).toHaveLength(1)
    expect(claims.filter((value) => value.status === "busy")).toHaveLength(11)
    const claim = claims.find((value) => value.status === "claimed")!
    if (claim.status !== "claimed") throw new Error("No owner")
    expect(await journal.complete(stage, claim.lease, { assetId: "retained-recipe" })).toBe(true)
    expect(await journal.claim(stage, 1000)).toEqual({ status: "completed", output: { assetId: "retained-recipe" } })
    expect(await journal.complete(stage, claim.lease, { assetId: "replacement" })).toBe(false)
  })

  it("preserves checkpoints for adoption and fences expired workers", async () => {
    const journal = createStageJournal(redis, async () => {})
    const stage = key()
    const first = await journal.claim(stage, 1000)
    if (first.status !== "claimed") throw new Error("No owner")
    expect(await journal.checkpoint(stage, first.lease, { childJobId: "existing-child" })).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(await journal.complete(stage, first.lease, { wrong: true })).toBe(false)
    expect(await journal.renew(stage, first.lease, 1000)).toBeNull()
    const next = await journal.claim(stage, 1000)
    if (next.status !== "claimed") throw new Error("No successor")
    expect(next.lease.fence).toBe(first.lease.fence + 1)
    expect(next.checkpoint).toEqual({ childJobId: "existing-child" })
    expect(await journal.release(stage, first.lease)).toBe(false)
    expect(await journal.renew(stage, next.lease, 2000)).toMatchObject({ token: next.lease.token })
    expect(await journal.complete(stage, next.lease, { accepted: true })).toBe(true)
  })

  it("recovers acknowledged output after a Redis process restart", async () => {
    const stage = key()
    const journal = createStageJournal(redis, async () => {})
    const claim = await journal.claim(stage, 1000)
    if (claim.status !== "claimed") throw new Error("No owner")
    expect(await journal.complete(stage, claim.lease, { artifactId: "persisted-output" })).toBe(true)
    await stop()
    await start()
    expect(await createStageJournal(redis, async () => {}).claim(stage, 1000))
      .toEqual({ status: "completed", output: { artifactId: "persisted-output" } })
  })
})
