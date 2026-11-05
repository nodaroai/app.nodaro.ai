/**
 * `ErrorHint` is a DISCRIMINATED UNION (spec §9, D12): a provider's safety
 * block and a Nodaro-side policy block ride the same `jobs.error_hint` column,
 * the same `PUBLIC_JOB_KEYS` projection and the same four hand-copied mirrors.
 *
 * What this file protects:
 *
 *   1. `kind` really discriminates. It was already the discriminant in every
 *      reader (`hint.kind === "safety-block"`), which is the whole reason this
 *      widening breaks nothing — but "nothing breaks" is a claim, and the
 *      narrowing assertions below are the proof. They are COMPILE-TIME
 *      assertions: backend/tsconfig.json's `include` covers all of src, so
 *      `__tests__` is type-checked by `npx tsc --noEmit`. A regression that made
 *      `suggestedProvider` reachable on the union (say, by flattening it back
 *      into one optional-everything object) fails tsc, not just vitest.
 *   2. The union is CLOSED. The `never` exhaustiveness check fails the moment a
 *      new arm is added without every reader learning about it.
 *   3. `PolicyBlockHint.reason` is user-visible by contract (D13) — it is
 *      `userMessage ?? reason` and lands on the owner's canvas through
 *      `sanitizeJobForPublic`. The machine text stays in
 *      `job_policy_decisions.reason`. Nothing here can enforce that, so the
 *      shape test at least pins the field names a policy must fill.
 */

import { describe, expect, it } from "vitest"
import {
  audioRefusedOf,
  creditsHintOf,
  errorHintFor,
  inputRefusedHint,
  policyBlockHint,
  promptRefusedOf,
  queueTimeoutHintOf,
  refusalHintFor,
  requestRefusedHintOf,
  safetyBlockOf,
  type CreditsHint,
  type ErrorHint,
  type PolicyBlockHint,
  type SafetyBlockHint,
  type SafetyBlock,
} from "../safety-block.js"

describe("policyBlockHint", () => {
  it("builds the wire shape the frontend, MCP and SDK mirrors expect", () => {
    expect(policyBlockHint("sai-moderation", "This request was blocked.", "request")).toEqual({
      kind: "policy-block",
      policyId: "sai-moderation",
      reason: "This request was blocked.",
      hookPoint: "request",
    })
  })

  it("carries the hook point so the UI can say 'before it ran' vs 'not saved'", () => {
    expect(policyBlockHint("platform", "Generation could not be verified", "result").hookPoint).toBe(
      "result",
    )
  })
})

describe("ErrorHint is a discriminated union on `kind`", () => {
  const safety: ErrorHint = errorHintFor({ class: "safety", maxAttempts: 2, fallback: "m" }, true)
  const policy: ErrorHint = policyBlockHint("sai-moderation", "blocked", "result")

  it("narrows to the safety arm — suggestedProvider stays reachable", () => {
    if (safety.kind !== "safety-block") throw new Error("expected the safety arm")
    // Compile-time: these three properties exist ONLY on SafetyBlockHint.
    const cls: SafetyBlock["class"] = safety.class
    const retried: boolean = safety.retried
    const suggested: string | undefined = safety.suggestedProvider
    expect([cls, retried, suggested]).toEqual(["safety", true, "m"])
  })

  it("narrows to the policy arm", () => {
    if (policy.kind !== "policy-block") throw new Error("expected the policy arm")
    const policyId: string = policy.policyId
    const hookPoint: "request" | "result" = policy.hookPoint
    expect([policyId, hookPoint]).toEqual(["sai-moderation", "result"])
  })

  it("is closed — a new arm cannot be added without every reader learning it", () => {
    const describeHint = (hint: ErrorHint): string => {
      switch (hint.kind) {
        case "safety-block":
          return `provider:${hint.class}`
        case "policy-block":
          return `nodaro:${hint.policyId}`
        case "credits":
          return `credits:${hint.code}`
        case "input-refused":
          return `input:${hint.subject}`
        case "queue-timeout":
          return `queue:${hint.reason}:${hint.waitedMinutes}`
        case "request-refused":
          return `request:${hint.subject ?? "as sent"}`
        default: {
          const exhaustive: never = hint
          return exhaustive
        }
      }
    }
    expect(describeHint(safety)).toBe("provider:safety")
    expect(describeHint(policy)).toBe("nodaro:sai-moderation")
    expect(describeHint({ kind: "credits", code: "insufficient_credits" })).toBe("credits:insufficient_credits")
    expect(describeHint(inputRefusedHint())).toBe("input:input_video")
    expect(describeHint({ kind: "queue-timeout", reason: "timeout", waitedMinutes: 120 })).toBe("queue:timeout:120")
    expect(describeHint({ kind: "request-refused" })).toBe("request:as sent")
    expect(describeHint({ kind: "request-refused", subject: "input_video" })).toBe("request:input_video")
  })

  it("keeps errorHintFor producing the safety arm (migration 376 readers unchanged)", () => {
    const hint: SafetyBlockHint = errorHintFor({ class: "copyright", maxAttempts: 1 }, false)
    expect(hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
    expect(hint).not.toHaveProperty("suggestedProvider")
    // Assignable to the union without a cast — the mirrors store one column.
    const widened: ErrorHint = hint
    expect(widened.kind).toBe("safety-block")
  })

  it("both arms are assignable to the one column type", () => {
    const column: (ErrorHint | null)[] = [safety, policy, null]
    const kinds = column.map((h) => h?.kind ?? "none")
    expect(kinds).toEqual(["safety-block", "policy-block", "none"])
    const onlyPolicy: PolicyBlockHint[] = column.filter(
      (h): h is PolicyBlockHint => h?.kind === "policy-block",
    )
    expect(onlyPolicy).toHaveLength(1)
  })
})

describe("creditsHintOf — a handler's credits refusal, read off the thrown error", () => {
  const refused = (failureHint: unknown, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error("the child job was refused"), { failureHint }, extra)

  it("reads a well-formed hint on the error itself", () => {
    const hint: CreditsHint | null = creditsHintOf(refused({ kind: "credits", code: "insufficient_credits" }))
    expect(hint).toEqual({ kind: "credits", code: "insufficient_credits" })
  })

  it("reads it anywhere on the cause chain", () => {
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: refused({ kind: "credits", code: "free_video_limit" }) }) })
    expect(creditsHintOf(wrapped)).toEqual({ kind: "credits", code: "free_video_limit" })
  })

  it("copies only kind and code — nothing else the thrower attached rides along", () => {
    const hint = creditsHintOf(refused({ kind: "credits", code: "budget_exceeded", detail: "internal", balance: 3 }))
    expect(hint).toEqual({ kind: "credits", code: "budget_exceeded" })
    expect(Object.keys(hint ?? {})).toEqual(["kind", "code"])
  })

  it.each([
    ["another kind", { kind: "safety-block", code: "insufficient_credits" }],
    ["no code", { kind: "credits" }],
    ["a non-string code", { kind: "credits", code: 402 }],
    ["free text as the code", { kind: "credits", code: "Not enough credits for /v1/x" }],
    ["an uppercase code", { kind: "credits", code: "INSUFFICIENT" }],
    ["an empty code", { kind: "credits", code: "" }],
    ["a 65-character code", { kind: "credits", code: "a".repeat(65) }],
    ["a string hint", "credits"],
    ["a null hint", null],
  ])("ignores a malformed hint: %s", (_label, failureHint) => {
    expect(creditsHintOf(refused(failureHint))).toBeNull()
  })

  it("is null for errors without a hint, and for non-errors", () => {
    expect(creditsHintOf(new Error("plain"))).toBeNull()
    expect(creditsHintOf("a string")).toBeNull()
    expect(creditsHintOf(null)).toBeNull()
    expect(creditsHintOf(undefined)).toBeNull()
  })

  it("stops on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown }
    const b = new Error("b", { cause: a })
    a.cause = b
    expect(creditsHintOf(a)).toBeNull()
  })

  it.each([
    ["failureHint", () => Object.defineProperty(new Error("x"), "failureHint", { get() { throw new Error("boom") } })],
    ["kind", () => refused(Object.defineProperty({ code: "insufficient_credits" }, "kind", { get() { throw new Error("boom") } }))],
    ["code", () => refused(Object.defineProperty({ kind: "credits" }, "code", { get() { throw new Error("boom") } }))],
    ["cause", () => Object.defineProperty(new Error("x"), "cause", { get() { throw new Error("boom") } })],
    ["a Proxy", () => new Proxy(new Error("x"), { get() { throw new Error("boom") } })],
  ])("never throws — a throwing %s reads as no hint (the worker's refund path must run)", (_label, make) => {
    expect(() => creditsHintOf(make())).not.toThrow()
    expect(creditsHintOf(make())).toBeNull()
  })

  it("accepts a 64-character code (the upper bound)", () => {
    expect(creditsHintOf(refused({ kind: "credits", code: "a".repeat(64) }))?.code).toBe("a".repeat(64))
  })
})

describe("safetyBlockOf never throws", () => {
  it.each([
    ["contentPolicyClass getter", () => Object.defineProperty(new Error("x"), "contentPolicyClass", { get() { throw new Error("boom") } })],
    ["a Proxy", () => new Proxy(new Error("x"), { get() { throw new Error("boom") }, getPrototypeOf() { throw new Error("boom") } })],
  ])("a throwing %s reads as not a block", (_label, make) => {
    expect(() => safetyBlockOf(make(), "gpt-image-2")).not.toThrow()
    expect(safetyBlockOf(make(), "gpt-image-2")).toBeNull()
  })
})

describe("a request the provider refused, read off the thrown error", () => {
  const refused = (over = {}) => Object.assign(new Error("x"), { requestRefused: true, ...over })

  it("reads the flag off the error and off its cause chain", () => {
    expect(requestRefusedHintOf(refused())).toEqual({ kind: "request-refused" })
    expect(requestRefusedHintOf(new Error("outer", { cause: refused() }))).toEqual({ kind: "request-refused" })
  })

  it("carries the input video as its subject, and nothing else", () => {
    const sentAVideo = { referenceVideoUrls: ["https://cdn.example/src.mp4"] }
    expect(requestRefusedHintOf(refused({ requestRefusedSubject: "input_video" }), sentAVideo)).toEqual({ kind: "request-refused", subject: "input_video" })
    expect(requestRefusedHintOf(refused({ requestRefusedSubject: "the moon", detail: "secret" }), sentAVideo)).toEqual({ kind: "request-refused" })
  })

  it("names no input video on a job that sent none", () => {
    expect(requestRefusedHintOf(refused({ requestRefusedSubject: "input_video" }), {})).toEqual({ kind: "request-refused" })
  })

  it("a flag that is not exactly true, or no flag, is no refusal", () => {
    expect(requestRefusedHintOf(new Error("x"))).toBeNull()
    expect(requestRefusedHintOf(Object.assign(new Error("x"), { requestRefused: "yes" }))).toBeNull()
    expect(requestRefusedHintOf(Object.assign(new Error("x"), { requestRefused: false, requestRefusedSubject: "input_video" }))).toBeNull()
    expect(requestRefusedHintOf(null)).toBeNull()
  })

  it("never throws", () => {
    expect(requestRefusedHintOf(Object.defineProperty(new Error("x"), "requestRefused", { get() { throw new Error("boom") } }))).toBeNull()
  })

  it("files the hint under a content block and a refused input video", () => {
    const hint = { kind: "request-refused" } as const
    expect(refusalHintFor(null, false, false, false, hint)).toEqual(hint)
    expect(refusalHintFor(null, false, false, false, null)).toBeNull()
    expect(refusalHintFor(null, false, false)).toBeNull()
    expect(refusalHintFor(null, false, true, false, hint)).toEqual({ kind: "input-refused", subject: "input_video" })
    expect(refusalHintFor({ class: "safety", maxAttempts: 2 }, true, false, false, hint)).toEqual({ kind: "safety-block", class: "safety", retried: true })
  })
})

describe("a refusal whose provider words named the prompt", () => {
  const block = (cls: SafetyBlock["class"]): SafetyBlock => ({ class: cls, maxAttempts: 1 })

  it("the hint says so, on any class", () => {
    expect(errorHintFor(block("copyright"), false, { promptRefused: true }).subject).toBe("prompt")
    expect(errorHintFor(block("likeness"), false, { promptRefused: true }).subject).toBe("prompt")
    expect(errorHintFor(block("safety"), false, { promptRefused: true }).subject).toBe("prompt")
  })

  it("a named input wins over the prompt", () => {
    expect(errorHintFor(block("copyright"), false, { inputVideoRefused: true, promptRefused: true }).subject).toBe("input_video")
    expect(errorHintFor(block("copyright"), false, { inputImageRefused: true, promptRefused: true }).subject).toBe("input_image")
  })

  it("a hint with no flag has no subject", () => {
    expect(errorHintFor(block("copyright"), false).subject).toBeUndefined()
    expect(errorHintFor(block("copyright"), false, { promptRefused: false }).subject).toBeUndefined()
  })

  it("the writers' one mapping takes it as its last argument, and only beside a block", () => {
    expect(refusalHintFor(block("copyright"), false, false, false, null, true)).toMatchObject({ kind: "safety-block", subject: "prompt" })
    expect(refusalHintFor(block("copyright"), false, false, false, null)).toEqual({ kind: "safety-block", class: "copyright", retried: false })
    expect(refusalHintFor(null, false, false, false, null, true)).toBeNull()
  })
})

describe("a refusal whose provider words blamed the generated audio", () => {
  const block = (cls: SafetyBlock["class"]): SafetyBlock => ({ class: cls, maxAttempts: 1 })

  it("the hint says so, on any class", () => {
    expect(errorHintFor(block("copyright"), false, { audioRefused: true }).subject).toBe("audio")
    expect(errorHintFor(block("likeness"), false, { audioRefused: true }).subject).toBe("audio")
    expect(errorHintFor(block("safety"), false, { audioRefused: true }).subject).toBe("audio")
  })

  it("the prompt and a named input win over the audio", () => {
    expect(errorHintFor(block("copyright"), false, { promptRefused: true, audioRefused: true }).subject).toBe("prompt")
    expect(errorHintFor(block("copyright"), false, { inputVideoRefused: true, audioRefused: true }).subject).toBe("input_video")
    expect(errorHintFor(block("copyright"), false, { inputImageRefused: true, audioRefused: true }).subject).toBe("input_image")
  })

  it("a hint with no flag has no subject", () => {
    expect(errorHintFor(block("copyright"), false, { audioRefused: false }).subject).toBeUndefined()
  })

  it("the writers' one mapping takes it as its last argument, and only beside a block", () => {
    expect(refusalHintFor(block("copyright"), false, false, false, null, false, true)).toEqual({
      kind: "safety-block", class: "copyright", retried: false, subject: "audio",
    })
    expect(refusalHintFor(block("copyright"), false, false, false, null, true, true)).toMatchObject({ subject: "prompt" })
    expect(refusalHintFor(null, false, false, false, null, false, true)).toBeNull()
  })
})

describe("audioRefusedOf", () => {
  it("reads the flag on the error or its cause chain", () => {
    const inner = Object.assign(new Error("inner"), { audioRefused: true })
    expect(audioRefusedOf(inner)).toBe(true)
    expect(audioRefusedOf(new Error("outer", { cause: inner }))).toBe(true)
  })

  it("is false for anything else, and never throws", () => {
    expect(audioRefusedOf(new Error("The generated audio was refused"))).toBe(false)
    expect(audioRefusedOf(Object.assign(new Error("x"), { audioRefused: "true" }))).toBe(false)
    expect(audioRefusedOf(null)).toBe(false)
    const hostile = Object.defineProperty(new Error("x"), "audioRefused", { get() { throw new Error("boom") } })
    expect(audioRefusedOf(hostile)).toBe(false)
  })
})

describe("promptRefusedOf", () => {
  it("reads the flag on the error or its cause chain", () => {
    const inner = Object.assign(new Error("inner"), { promptRefused: true })
    expect(promptRefusedOf(inner)).toBe(true)
    expect(promptRefusedOf(new Error("outer", { cause: inner }))).toBe(true)
  })

  it("is false for anything else, and never throws", () => {
    expect(promptRefusedOf(new Error("The prompt was refused"))).toBe(false)
    expect(promptRefusedOf(Object.assign(new Error("x"), { promptRefused: "true" }))).toBe(false)
    expect(promptRefusedOf(null)).toBe(false)
    const hostile = Object.defineProperty(new Error("x"), "promptRefused", { get() { throw new Error("boom") } })
    expect(promptRefusedOf(hostile)).toBe(false)
  })
})

describe("queueTimeoutHintOf — a wait for a concurrency slot that ran out", () => {
  const timedOut = (failureHint: unknown) => Object.assign(new Error("Waited longer than 120 min for a free slot."), { failureHint })

  it("reads the hint a LaneWaitTimeoutError carries", async () => {
    const { LaneWaitTimeoutError } = await import("../concurrency-lanes/errors.js")
    const err = new LaneWaitTimeoutError({ reason: "timeout", waitedMs: 125 * 60_000, timeoutMinutes: 120 })
    expect(queueTimeoutHintOf(err)).toEqual({ kind: "queue-timeout", reason: "timeout", waitedMinutes: 125 })
    expect(queueTimeoutHintOf(new Error("outer", { cause: err }))).toEqual({ kind: "queue-timeout", reason: "timeout", waitedMinutes: 125 })
  })

  it("copies only the three fields, as a fresh object, the minutes whole and non-negative", () => {
    const hint = { kind: "queue-timeout", reason: "lost", waitedMinutes: 7.9, internal: "x" }
    const read = queueTimeoutHintOf(timedOut(hint))
    expect(read).toEqual({ kind: "queue-timeout", reason: "lost", waitedMinutes: 7 })
    expect(read).not.toBe(hint)
    expect(Object.keys(read ?? {})).toEqual(["kind", "reason", "waitedMinutes"])
    expect(queueTimeoutHintOf(timedOut({ kind: "queue-timeout", reason: "live-wait", waitedMinutes: -3 }))?.waitedMinutes).toBe(0)
  })

  it.each([
    ["another kind", { kind: "credits", reason: "timeout", waitedMinutes: 1 }],
    ["a reason outside the set", { kind: "queue-timeout", reason: "busy", waitedMinutes: 1 }],
    ["no minutes", { kind: "queue-timeout", reason: "timeout" }],
    ["non-finite minutes", { kind: "queue-timeout", reason: "timeout", waitedMinutes: Number.NaN }],
    ["a string hint", "queue-timeout"],
  ])("ignores a malformed hint: %s", (_label, failureHint) => {
    expect(queueTimeoutHintOf(timedOut(failureHint))).toBeNull()
  })

  it("never throws", () => {
    expect(queueTimeoutHintOf(Object.defineProperty(new Error("x"), "failureHint", { get() { throw new Error("boom") } }))).toBeNull()
    expect(queueTimeoutHintOf(null)).toBeNull()
  })
})
