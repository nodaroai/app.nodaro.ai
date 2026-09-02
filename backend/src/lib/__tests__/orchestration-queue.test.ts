/**
 * B6 (spec §7). `attempts` on the orchestration queue is the retry budget for
 * a throw that escapes the worker wrapper — the drain path deliberately does
 * NOT spend one (orchestrator-worker.ts moves the job to delayed and signals
 * DelayedError). The resume guard makes a retry of an already-terminal
 * execution a no-op, so retrying is safe.
 *
 * M-10a: these constants live in `orchestration-queue-config.ts`, a leaf with
 * NO imports, precisely so this file needs no mocks. `orchestration-queue.ts`
 * constructs `new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })`
 * AND `new Queue(...)` at MODULE LOAD, and `maxRetriesPerRequest: null` means
 * retry forever — so a bare import of THAT module under the full suite is the
 * documented "Backend Tests hang on real Redis" failure, which looks exactly
 * like the video-sfx flake. Read the values from the leaf; the queue module
 * re-exports them for production callers.
 */
import { describe, it, expect } from "vitest"
import {
  ORCHESTRATION_JOB_OPTIONS,
  ORCHESTRATION_JOB_ATTEMPTS,
  ORCHESTRATOR_ALIVE_STATES,
} from "../orchestration-queue-config.js"

describe("orchestration queue defaults", () => {
  it("retries a genuinely thrown execution a bounded number of times", () => {
    expect(ORCHESTRATION_JOB_ATTEMPTS).toBe(3)
    expect(ORCHESTRATION_JOB_OPTIONS.attempts).toBe(3)
  })

  it("backs off between attempts so a Redis blip is not hammered", () => {
    expect(ORCHESTRATION_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 10_000,
    })
  })

  it("keeps the existing retention window", () => {
    expect(ORCHESTRATION_JOB_OPTIONS.removeOnComplete).toEqual({ count: 200 })
    expect(ORCHESTRATION_JOB_OPTIONS.removeOnFail).toEqual({ count: 100 })
  })
})

describe("orchestrator alive states", () => {
  it("covers every queued-or-running BullMQ state", () => {
    expect([...ORCHESTRATOR_ALIVE_STATES].sort()).toEqual([
      "active",
      "delayed",
      "prioritized",
      "waiting",
      "waiting-children",
    ])
  })
})
