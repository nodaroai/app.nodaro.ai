import { describe, it, expect, beforeEach } from "vitest"
import {
  beginWorkerDrain,
  isWorkerDraining,
  DrainAbortError,
  _resetWorkerDrainForTests,
} from "../worker-drain.js"

describe("worker-drain", () => {
  beforeEach(() => {
    _resetWorkerDrainForTests()
  })

  it("is not draining by default", () => {
    expect(isWorkerDraining()).toBe(false)
  })

  it("beginWorkerDrain flips the flag (idempotent)", () => {
    beginWorkerDrain()
    expect(isWorkerDraining()).toBe(true)
    beginWorkerDrain()
    expect(isWorkerDraining()).toBe(true)
  })

  it("DrainAbortError carries a stable name for cross-module classification", () => {
    const err = new DrainAbortError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("DrainAbortError")
    expect(err.message).toContain("drain")
  })
})
