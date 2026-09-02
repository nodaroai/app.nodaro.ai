import { describe, it, expect } from "vitest"
import { assembleFanOutResult, type FanOutIterationValue } from "../fan-out-result.js"
import { DrainAbortError } from "../../lib/worker-drain.js"

// --- builders -------------------------------------------------------------

function ok(
  index: number,
  resultValue: string,
  extra: { jobId?: string; usageLogId?: string; creditsUsed?: number; output?: Record<string, unknown> } = {},
): PromiseSettledResult<FanOutIterationValue> {
  return {
    status: "fulfilled",
    value: {
      index,
      resultValue,
      result: {
        output: extra.output ?? { imageUrl: resultValue },
        jobId: extra.jobId,
        usageLogId: extra.usageLogId,
        creditsUsed: extra.creditsUsed ?? 0,
      },
    } as FanOutIterationValue,
  }
}

const fail = (msg: string): PromiseSettledResult<FanOutIterationValue> => ({
  status: "rejected",
  reason: new Error(msg),
})

/** A deploy drain aborting one iteration's wait (node-executor's job poll). */
const drain = (
  reason: DrainAbortError = new DrainAbortError(),
): PromiseSettledResult<FanOutIterationValue> => ({ status: "rejected", reason })

// --- tests ----------------------------------------------------------------

describe("assembleFanOutResult", () => {
  it("all succeeded: primary = index 0, listResults in order, credits summed", () => {
    const r = assembleFanOutResult(
      [
        ok(0, "https://img/0.png", { jobId: "j0", creditsUsed: 2, usageLogId: "u0" }),
        ok(1, "https://img/1.png", { jobId: "j1", creditsUsed: 3, usageLogId: "u1" }),
      ],
      2,
    )
    expect(r.output.imageUrl).toBe("https://img/0.png") // index 0 is primary
    expect(r.output.listResults).toEqual(["https://img/0.png", "https://img/1.png"])
    expect(r.succeededCount).toBe(2)
    expect(r.genuineFailure).toBeUndefined()
    expect(r.creditsUsed).toBe(5)
    expect(r.jobIds).toEqual(["j0", "j1"])
  })

  it("ALL failed (nothing produced): throws the genuine failure so the run fail-fasts", () => {
    expect(() =>
      assembleFanOutResult([fail("KIE 500: content policy"), fail("Execution cancelled")], 2),
    ).toThrow("KIE 500: content policy")
  })

  it("partial (index 0 ok, index 1 failed): keeps successes, reports the failure, does NOT throw", () => {
    const r = assembleFanOutResult([ok(0, "https://img/0.png"), fail("provider 503")], 2)
    expect(r.succeededCount).toBe(1)
    expect(r.genuineFailure).toBeInstanceOf(Error)
    expect(r.output.imageUrl).toBe("https://img/0.png")
    expect(r.output.listResults).toEqual(["https://img/0.png", ""])
  })

  it("REGRESSION: index 0 failed but index 1 succeeded → primary hydrated from index 1 (not blank)", () => {
    // fail-fast realistic shape: genuine failure at 0 cancels the rest, but an
    // already-running later iteration completed.
    const r = assembleFanOutResult(
      [fail("index-0 boom"), ok(1, "https://img/1.png", { output: { videoUrl: "https://v/1.mp4" } })],
      2,
    )
    expect(r.succeededCount).toBe(1)
    // Without the fix this would be undefined → downstream runs on empty input.
    expect(r.output.videoUrl).toBe("https://v/1.mp4")
    expect(r.output.listResults).toEqual(["", "https://img/1.png"])
  })

  it("pure cancellation (0 succeeded, only cancellation sentinels): no throw, empty output", () => {
    const r = assembleFanOutResult([fail("Cancelled"), fail("Execution cancelled")], 2)
    expect(r.succeededCount).toBe(0)
    expect(r.genuineFailure).toBeUndefined() // not treated as a failure
    expect(r.output.listResults).toEqual(["", ""])
    expect(r.output.imageUrl).toBeUndefined()
  })

  it("does not throw on a genuine failure as long as something succeeded (matches frontend)", () => {
    // [ok(0), genuine fail(1), cancelled(2)] — fail-fast cancels iteration 2.
    const r = assembleFanOutResult([ok(0, "a"), fail("real error"), fail("Execution cancelled")], 3)
    expect(r.succeededCount).toBe(1)
    expect(r.genuineFailure).toBeInstanceOf(Error)
    expect(r.output.listResults).toEqual(["a", "", ""])
  })

  it("single jobId is not surfaced as jobIds (only >1)", () => {
    const r = assembleFanOutResult([ok(0, "a", { jobId: "only" })], 1)
    expect(r.jobId).toBe("only")
    expect(r.jobIds).toBeUndefined()
  })

  // --- B6b: deploy drain is never a tolerated iteration failure ------------

  it("DRAIN: throws even when other iterations succeeded (never a partial result)", () => {
    // Money rule: the drained iteration's child job is still running in the
    // video worker and WILL finalize its charge. Tolerating it would persist
    // the node `completed` with "" for that item — the user pays for output
    // the execution discarded — and the orchestrator's drain hatch would
    // never see the abort.
    expect(() =>
      assembleFanOutResult([ok(0, "https://img/0.png"), drain(), fail("Execution cancelled")], 3),
    ).toThrow(DrainAbortError)
  })

  it("DRAIN: rethrows the SAME instance, so hatch A's instanceof check still matches", () => {
    const reason = new DrainAbortError()
    let caught: unknown
    try {
      assembleFanOutResult([ok(0, "a"), drain(reason)], 2)
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(reason)
  })

  it("DRAIN: an ordinary Error is STILL tolerated when something succeeded (unchanged)", () => {
    const r = assembleFanOutResult([ok(0, "a"), fail("provider 503")], 2)
    expect(r.succeededCount).toBe(1)
    expect(r.genuineFailure).toBeInstanceOf(Error)
    expect(r.genuineFailure).not.toBeInstanceOf(DrainAbortError)
    expect(r.output.listResults).toEqual(["a", ""])
  })
})
