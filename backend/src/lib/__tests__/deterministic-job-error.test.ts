// A subclass of DeterministicJobError is still itself (`instanceof` its own
// class, for a caller that catches one kind) AND deterministic (for the worker).
import { describe, it, expect } from "vitest"
import { DeterministicJobError, isDeterministicJobError } from "../deterministic-job-error.js"

class NoAudio extends DeterministicJobError {
  constructor() { super("the source has no audio track"); this.name = "NoAudio" }
}

describe("DeterministicJobError", () => {
  it("a direct instance is deterministic and an Error", () => {
    const e = new DeterministicJobError("refused")
    expect(e).toBeInstanceOf(DeterministicJobError)
    expect(e).toBeInstanceOf(Error)
    expect(isDeterministicJobError(e)).toBe(true)
  })
  it("a subclass instance is its own class, the base class and deterministic", () => {
    const e = new NoAudio()
    expect(e).toBeInstanceOf(NoAudio)
    expect(e).toBeInstanceOf(DeterministicJobError)
    expect(isDeterministicJobError(e)).toBe(true)
    expect(e.message).toBe("the source has no audio track")
  })
  it("is found through a wrapper's cause chain", () => {
    expect(isDeterministicJobError(new Error("wrapped", { cause: new NoAudio() }))).toBe(true)
    expect(isDeterministicJobError(new Error("transient"))).toBe(false)
  })
})
