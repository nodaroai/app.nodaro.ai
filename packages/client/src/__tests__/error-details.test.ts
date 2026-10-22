/**
 * What an error keeps of the server's answer beyond its code and message:
 *
 * - `details` — every other field of the `{ error: { code, message, … } }`
 *   envelope, as sent (a trend refusal's `slot`, a publish refusal's
 *   `reasons`, a validation error's `issues`, a nested `details` object…), on
 *   every error class, so a caller can act on them without an SDK release;
 * - on a 402, the refusal's own code: a personal balance that cannot cover the
 *   run (`insufficient_credits`) stays distinguishable from a spending cap set
 *   by someone else (a workspace budget, a member cap in a workspace, a
 *   deployment's per-user allowance), which is a `CreditCapExceededError` —
 *   still an `InsufficientCreditsError`, so every existing catch keeps working.
 */
import { describe, it, expect } from "vitest"
import {
  CREDIT_CAP_CODES,
  CreditCapExceededError,
  InsufficientCreditsError,
  NodaroError,
  NotFoundError,
  WorkflowConflictError,
  throwFromResponse,
} from "../errors.js"

function thrown(status: number, body: unknown): NodaroError {
  try {
    throwFromResponse(status, body as Parameters<typeof throwFromResponse>[1])
  } catch (err) {
    return err as NodaroError
  }
  throw new Error("throwFromResponse returned")
}

describe("NodaroError.details — the envelope's other fields", () => {
  it("keeps every envelope field but code and message, as sent", () => {
    const err = thrown(400, {
      error: {
        code: "missing_slot",
        message: "Slot lead needs pictures.",
        slot: "lead",
        retryable: false,
        details: { code: "inner", hint: "x" },
      },
    })
    expect(err).toBeInstanceOf(NodaroError)
    expect(err.code).toBe("missing_slot")
    expect(err.details).toEqual({ slot: "lead", retryable: false, details: { code: "inner", hint: "x" } })
  })

  it("is on the typed classes too", () => {
    const missing = thrown(404, { error: { code: "not_found", message: "Trend not found", what: "trend" } })
    expect(missing).toBeInstanceOf(NotFoundError)
    expect(missing.details).toEqual({ what: "trend" })

    const conflict = thrown(409, { error: { code: "workflow_conflict", message: "x", currentVersion: 3 } })
    expect(conflict).toBeInstanceOf(WorkflowConflictError)
    expect(conflict.details).toEqual({ currentVersion: 3 })

    const blocked = thrown(409, {
      error: { code: "publish_blocked", message: "Cannot publish.", reasons: [{ code: "no_examples" }] },
    })
    expect(blocked.details).toEqual({ reasons: [{ code: "no_examples" }] })
  })

  it("is an empty object when the envelope has nothing else, or there is no envelope", () => {
    expect(thrown(400, { error: { code: "validation_error", message: "Bad" } }).details).toEqual({})
    expect(thrown(409, { error: "already_training_or_not_found" }).details).toEqual({})
    expect(thrown(500, null).details).toEqual({})
    // A hand-made error has none either.
    expect(new NodaroError("x", "y", 400).details).toEqual({})
  })

  it("is a copy: changing it never changes another error's", () => {
    const body = { error: { code: "x_y", message: "m", slot: "a" } }
    const a = thrown(400, body)
    ;(a.details as Record<string, unknown>).slot = "b"
    expect(thrown(400, body).details).toEqual({ slot: "a" })
  })
})

describe("402 — a personal balance vs a spending cap", () => {
  it("insufficient_credits stays an InsufficientCreditsError with that code", () => {
    const err = thrown(402, { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 100, balance: 40 })
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).not.toBeInstanceOf(CreditCapExceededError)
    expect(err).toMatchObject({ code: "insufficient_credits", status: 402, required: 100, available: 40 })
  })

  it("a 402 with no code at all is insufficient_credits", () => {
    expect(thrown(402, {})).toMatchObject({ code: "insufficient_credits", status: 402 })
  })

  it.each([
    ["budget_exceeded", "The workspace budget cannot cover this run"],
    ["member_cap_exceeded", "Your credit cap in this workspace cannot cover this run"],
    ["user_allowance_exceeded", "Your allowance cannot cover this run"],
  ])("%s is a CreditCapExceededError — and still an InsufficientCreditsError", (code, message) => {
    const err = thrown(402, { error: { code, message }, required: 120 })
    expect(err).toBeInstanceOf(CreditCapExceededError)
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).toMatchObject({ name: "CreditCapExceededError", code, status: 402, message, required: 120 })
  })

  it("the allowance's `remaining` (beside the envelope) is read as `available`", () => {
    const err = thrown(402, {
      error: { code: "user_allowance_exceeded", message: "Your allowance cannot cover this run" },
      required: 120,
      remaining: 30,
    })
    expect(err).toMatchObject({ required: 120, available: 30 })
  })

  it("any other 402 code is kept on an InsufficientCreditsError (not a cap)", () => {
    const err = thrown(402, { error: { code: "free_video_limit", message: "Free plan video limit reached" } })
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).not.toBeInstanceOf(CreditCapExceededError)
    expect(err.code).toBe("free_video_limit")
  })

  it("names the cap codes", () => {
    expect([...CREDIT_CAP_CODES].sort()).toEqual(["budget_exceeded", "member_cap_exceeded", "user_allowance_exceeded"])
  })

  it("constructing the classes by hand keeps the old defaults", () => {
    expect(new InsufficientCreditsError()).toMatchObject({ code: "insufficient_credits", status: 402, message: "Insufficient credits" })
    expect(new CreditCapExceededError("budget_exceeded")).toMatchObject({ code: "budget_exceeded", status: 402 })
  })
})
