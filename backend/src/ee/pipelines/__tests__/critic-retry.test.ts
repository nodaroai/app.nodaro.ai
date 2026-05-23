import { describe, it, expect, vi } from "vitest"
import {
  runCriticRetryLoop,
  buildCriticFeedbackPrompt,
} from "../_critic-retry.js"

// ─── runCriticRetryLoop ─────────────────────────────────────────────────────

// A trivial verdict shape used by these tests — the helper is generic so its
// only contract is the predicate.
interface TestVerdict {
  ok: boolean
  score: number
}

const passing: TestVerdict = { ok: true, score: 10 }
const failing: TestVerdict = { ok: false, score: 1 }

const isFail = (v: TestVerdict) => !v.ok

describe("runCriticRetryLoop", () => {
  it("initial verdict passes — runAttempt never called, retryCount=0", async () => {
    const runAttempt = vi.fn()
    const result = await runCriticRetryLoop({
      initial: passing,
      maxRetries: 2,
      isBlockingFail: isFail,
      runAttempt,
    })
    expect(result.finalVerdict).toBe(passing)
    expect(result.retryCount).toBe(0)
    expect(result.failed).toBe(false)
    expect(runAttempt).not.toHaveBeenCalled()
  })

  it("initial fails, attempt 1 passes — 1 retry, failed=false", async () => {
    const runAttempt = vi.fn().mockResolvedValueOnce(passing)
    const result = await runCriticRetryLoop({
      initial: failing,
      maxRetries: 2,
      isBlockingFail: isFail,
      runAttempt,
    })
    expect(result.finalVerdict).toBe(passing)
    expect(result.retryCount).toBe(1)
    expect(result.failed).toBe(false)
    expect(runAttempt).toHaveBeenCalledTimes(1)
    // runAttempt(prevVerdict, attemptNumber) — verify both args.
    expect(runAttempt).toHaveBeenCalledWith(failing, 1)
  })

  it("initial fails, all retries fail — cap exhausted, failed=true", async () => {
    const stillFailing: TestVerdict = { ok: false, score: 2 }
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce(stillFailing)
      .mockResolvedValueOnce(stillFailing)
    const result = await runCriticRetryLoop({
      initial: failing,
      maxRetries: 2,
      isBlockingFail: isFail,
      runAttempt,
    })
    expect(result.finalVerdict).toBe(stillFailing)
    expect(result.retryCount).toBe(2)
    expect(result.failed).toBe(true)
    expect(runAttempt).toHaveBeenCalledTimes(2)
    // Second call passes the most recent verdict + attemptNumber=2.
    expect(runAttempt).toHaveBeenNthCalledWith(2, stillFailing, 2)
  })

  it("maxRetries=0 — never iterates; failed mirrors initial", async () => {
    const runAttempt = vi.fn()
    const failResult = await runCriticRetryLoop({
      initial: failing,
      maxRetries: 0,
      isBlockingFail: isFail,
      runAttempt,
    })
    expect(failResult.finalVerdict).toBe(failing)
    expect(failResult.retryCount).toBe(0)
    expect(failResult.failed).toBe(true)
    expect(runAttempt).not.toHaveBeenCalled()

    const passResult = await runCriticRetryLoop({
      initial: passing,
      maxRetries: 0,
      isBlockingFail: isFail,
      runAttempt,
    })
    expect(passResult.failed).toBe(false)
    expect(runAttempt).not.toHaveBeenCalled()
  })

  it("runAttempt throws — error propagates (no swallow)", async () => {
    const boom = new Error("regen blew up")
    const runAttempt = vi.fn().mockRejectedValueOnce(boom)
    await expect(
      runCriticRetryLoop({
        initial: failing,
        maxRetries: 2,
        isBlockingFail: isFail,
        runAttempt,
      }),
    ).rejects.toBe(boom)
  })

  it("isBlockingFail called for the initial verdict + each attempt's result + the final check", async () => {
    // Behavior: while-loop checks the latest verdict each iteration, then
    // the trailing `failed:` field re-checks the final verdict. So a 1-retry
    // pass-on-second-try path is: check(initial=fail) → attempt → check(new=pass)
    // → exit loop → check for final-state = 3 calls total.
    const isFailSpy = vi.fn().mockImplementation(isFail)
    const runAttempt = vi.fn().mockResolvedValueOnce(passing)
    await runCriticRetryLoop({
      initial: failing,
      maxRetries: 2,
      isBlockingFail: isFailSpy,
      runAttempt,
    })
    // 1 (initial check) + 1 (post-attempt check) + 1 (final classification) = 3
    expect(isFailSpy).toHaveBeenCalledTimes(3)
  })
})

// ─── buildCriticFeedbackPrompt ──────────────────────────────────────────────

describe("buildCriticFeedbackPrompt", () => {
  it("with blocking issues — joins `- {category}: {fix}` lines", () => {
    const out = buildCriticFeedbackPrompt({
      basePrompt: "a red ball on grass",
      identifiedAs: "a blue cube",
      blockingIssues: [
        { category: "wrong_subject", suggested_fix: "use a sphere" },
        { category: "wrong_attributes", suggested_fix: "make it red" },
      ],
      fallbackAdvice: "fallback ignored when issues present",
    })
    expect(out).toBe(
      "a red ball on grass\n\n" +
        "PRIOR ATTEMPT IDENTIFIED AS: a blue cube\n" +
        "ADJUSTMENTS NEEDED:\n" +
        "- wrong_subject: use a sphere\n" +
        "- wrong_attributes: make it red",
    )
  })

  it("with no blocking issues — uses fallback advice", () => {
    const out = buildCriticFeedbackPrompt({
      basePrompt: "shot prompt",
      identifiedAs: "the wrong action",
      blockingIssues: [],
      fallbackAdvice: "Improve overall adherence to the shot prompt.",
    })
    expect(out).toBe(
      "shot prompt\n\n" +
        "PRIOR ATTEMPT IDENTIFIED AS: the wrong action\n" +
        "ADJUSTMENTS NEEDED:\n" +
        "Improve overall adherence to the shot prompt.",
    )
  })

  it("empty blockingIssues array — also falls back to advice (defensive)", () => {
    // Same path as the test above; this case guards the empty-array branch
    // explicitly so a future refactor that uses .reduce() or similar can't
    // emit an empty string when the array is empty.
    const out = buildCriticFeedbackPrompt({
      basePrompt: "p",
      identifiedAs: "x",
      blockingIssues: [],
      fallbackAdvice: "advice",
    })
    expect(out).toContain("ADJUSTMENTS NEEDED:\nadvice")
  })
})
