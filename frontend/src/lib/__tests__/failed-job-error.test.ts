import { describe, expect, it } from "vitest"

import { caughtErrorWords, failedJobError } from "../failed-job-error"
import { mergeNodeData } from "../node-data-merge"

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."
const HINT = { kind: "policy-block", retryable: false }

describe("failedJobError", () => {
  it("is an error that says the sentence", () => {
    const err = failedJobError(SENTENCE, {})
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(SENTENCE)
  })

  it("carries the job's words and its hint", () => {
    const err = failedJobError(SENTENCE, { error_detail: WORDS, error_hint: HINT })
    expect(err).toMatchObject({ message: SENTENCE, errorDetail: WORDS, errorHint: HINT })
  })

  it.each([
    ["no words at all", {}],
    ["words that are null", { error_detail: null }],
    ["words that are empty", { error_detail: "" }],
  ])("carries no words key for a job with %s", (_name, job) => {
    expect(Object.keys(failedJobError(SENTENCE, job))).not.toContain("errorDetail")
  })

  it("carries no hint key for a job with none", () => {
    expect(Object.keys(failedJobError(SENTENCE, { error_detail: WORDS }))).toEqual(["errorDetail"])
    expect(Object.keys(failedJobError(SENTENCE, { error_hint: null }))).toEqual([])
  })
})

describe("caughtErrorWords", () => {
  it("names the words an error carries", () => {
    expect(caughtErrorWords(failedJobError(SENTENCE, { error_detail: WORDS }))).toEqual({ errorDetail: WORDS })
    expect(caughtErrorWords({ errorDetail: WORDS })).toEqual({ errorDetail: WORDS })
  })

  it.each([
    ["an error with no words", new Error(SENTENCE)],
    ["a failed job's error with no words", failedJobError(SENTENCE, { error_hint: HINT })],
    ["words that are empty", Object.assign(new Error(SENTENCE), { errorDetail: "" })],
    ["words that are not text", Object.assign(new Error(SENTENCE), { errorDetail: { reason: WORDS } })],
    ["a thrown string", SENTENCE],
    ["null", null],
    ["nothing", undefined],
  ])("leaves the key out for %s", (_name, err) => {
    const patch = caughtErrorWords(err)
    expect(patch).toEqual({})
    expect(Object.keys(patch)).toEqual([])
  })
})

describe("a failure written from a caught error", () => {
  const failureFrom = (err: unknown) => ({
    executionStatus: "failed",
    errorMessage: err instanceof Error ? err.message : "Unknown error",
    ...caughtErrorWords(err),
  })
  const earlier = { label: "Poster", executionStatus: "failed", errorMessage: SENTENCE, errorDetail: WORDS }

  it("puts the failed job's words under its sentence", () => {
    const out = mergeNodeData(
      { label: "Poster", executionStatus: "running" },
      failureFrom(failedJobError(SENTENCE, { error_detail: WORDS })),
    )
    expect(out).toEqual({ label: "Poster", executionStatus: "failed", errorMessage: SENTENCE, errorDetail: WORDS })
  })

  it("leaves an earlier failure's words to the merge rule when the error has none", () => {
    const out = mergeNodeData(earlier, failureFrom(new Error("Workflow changed during execution")))
    expect(out.errorMessage).toBe("Workflow changed during execution")
    expect(out.errorDetail).toBeUndefined()
  })

  it("keeps the words when the catch states the poll's own failure again", () => {
    expect(mergeNodeData(earlier, failureFrom(new Error(SENTENCE)))).toEqual(earlier)
  })
})
