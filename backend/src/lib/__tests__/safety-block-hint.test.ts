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
 *      third arm is added without every reader learning about it.
 *   3. `PolicyBlockHint.reason` is user-visible by contract (D13) — it is
 *      `userMessage ?? reason` and lands on the owner's canvas through
 *      `sanitizeJobForPublic`. The machine text stays in
 *      `job_policy_decisions.reason`. Nothing here can enforce that, so the
 *      shape test at least pins the field names a policy must fill.
 */

import { describe, expect, it } from "vitest"
import {
  errorHintFor,
  policyBlockHint,
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

  it("is closed — a third arm cannot be added without every reader learning it", () => {
    const describeHint = (hint: ErrorHint): string => {
      switch (hint.kind) {
        case "safety-block":
          return `provider:${hint.class}`
        case "policy-block":
          return `nodaro:${hint.policyId}`
        default: {
          const exhaustive: never = hint
          return exhaustive
        }
      }
    }
    expect(describeHint(safety)).toBe("provider:safety")
    expect(describeHint(policy)).toBe("nodaro:sai-moderation")
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
