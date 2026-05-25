/**
 * truncateCriticFields — runtime safety net for critic LLM emits that
 * overshoot schema caps. Verified contract:
 *   1. Within-cap values pass through unchanged + no log fires.
 *   2. Over-cap string is truncated to `cap-1` + "…" + one log entry per
 *      offending field, including field name + original length.
 *   3. Multiple over-cap fields produce one log entry each.
 *   4. Non-string fields (number, null, undefined, array) are ignored
 *      without crashing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { truncateCriticFields } from "../_critic-truncate.js"

beforeEach(() => vi.clearAllMocks())

describe("truncateCriticFields", () => {
  it("passes through when no field exceeds its cap and emits no log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const raw = {
      identified_subject: "short",
      approved_summary: "also short",
    }
    const result = truncateCriticFields(
      raw,
      { identified_subject: 500, approved_summary: 500 },
      { pipelineId: "p1", role: "character_image" },
    )
    expect(result).toBe(raw) // fast path — same reference
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("truncates an over-cap string to cap-length and logs once with field+original-length", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const longStr = "x".repeat(603)
    const raw = { identified_subject: longStr }
    const result = truncateCriticFields(
      raw,
      { identified_subject: 500 },
      { pipelineId: "p1", role: "character_image" },
    )
    // Truncated to exactly cap (499 chars + 1 ellipsis = 500)
    expect(result.identified_subject).toHaveLength(500)
    expect(result.identified_subject).toMatch(/…$/)
    // Original NOT mutated (helper is immutable)
    expect(raw.identified_subject).toHaveLength(603)
    // Log fires once with the right metadata
    expect(warnSpy).toHaveBeenCalledOnce()
    const logCall = warnSpy.mock.calls[0]!
    expect(logCall[0]).toBe("[critic-truncate]")
    const payload = JSON.parse(logCall[1] as string)
    expect(payload).toMatchObject({
      role: "character_image",
      pipelineId: "p1",
      field: "identified_subject",
      originalLen: 603,
      cap: 500,
    })
  })

  it("logs once per over-cap field when multiple fields overshoot in a single call", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const raw = {
      identified_subject: "x".repeat(610),
      approved_summary: "y".repeat(700),
    }
    truncateCriticFields(
      raw,
      { identified_subject: 500, approved_summary: 500 },
      { pipelineId: "p2", role: "location_image" },
    )
    expect(warnSpy).toHaveBeenCalledTimes(2)
    const fieldsLogged = warnSpy.mock.calls
      .map((c) => JSON.parse(c[1] as string).field as string)
      .sort()
    expect(fieldsLogged).toEqual(["approved_summary", "identified_subject"])
  })

  it("ignores non-string fields (number, null, undefined, missing, array) without crashing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const raw = {
      identified_subject: "short",
      prompt_adherence_score: 7,
      issues: [{ severity: "warning" }],
      approved_summary: null,
      // identified_action: undefined — not present at all
    } as Record<string, unknown>
    const result = truncateCriticFields(
      raw,
      {
        identified_subject: 500,
        prompt_adherence_score: 500, // wrong type — ignored
        issues: 500, // array — ignored
        approved_summary: 500, // null — ignored
        identified_action: 500, // missing — ignored
      },
      { pipelineId: "p3", role: "video_critic" },
    )
    expect(result).toBe(raw)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
