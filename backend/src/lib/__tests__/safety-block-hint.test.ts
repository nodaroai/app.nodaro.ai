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
  creditsHintOf,
  errorHintFor,
  inputRefusedHint,
  policyBlockHint,
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
