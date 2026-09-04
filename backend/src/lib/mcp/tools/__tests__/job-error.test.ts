import { describe, it, expect } from "vitest"
import { isContentRejection, isRetryableFailure, rejectionClassOf, failureGuidance } from "../_job-error.js"

describe("isRetryableFailure", () => {
  it("marks content-policy / safety failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Request flagged for moderation")).toBe(false)
    expect(isRetryableFailure("NSFW content detected")).toBe(false)
    expect(isRetryableFailure("prompt violates our content policy")).toBe(false)
  })

  it("marks input-shape-limit failures NON-retryable", () => {
    expect(
      isRetryableFailure(
        "Input file exceeds the size or duration limit. Please use a shorter or smaller file.",
      ),
    ).toBe(false)
    expect(isRetryableFailure("Image too large")).toBe(false)
  })

  it("treats transient / unknown failures as retryable", () => {
    expect(
      isRetryableFailure("Generation failed. Please try again or contact support."),
    ).toBe(true)
    expect(isRetryableFailure("Provider timeout after 30s")).toBe(true)
    expect(isRetryableFailure("Internal server error (502)")).toBe(true)
    expect(isRetryableFailure(null)).toBe(true)
    expect(isRetryableFailure(undefined)).toBe(true)
    expect(isRetryableFailure("")).toBe(true)
  })
})

describe("isContentRejection", () => {
  it("matches the safety/moderation subset", () => {
    expect(
      isContentRejection(
        "Content policy violation: The output was blocked by the provider's safety filter.",
      ),
    ).toBe(true)
    expect(isContentRejection("Request flagged for moderation")).toBe(true)
    expect(isContentRejection("NSFW content detected")).toBe(true)
  })

  it("does NOT match input-shape limits (non-retryable but not rejections)", () => {
    expect(isContentRejection("Input file exceeds the size or duration limit.")).toBe(false)
    expect(isContentRejection("Image too large")).toBe(false)
  })

  it("does NOT match transient / absent reasons", () => {
    expect(isContentRejection("Provider timeout after 30s")).toBe(false)
    expect(isContentRejection(null)).toBe(false)
    expect(isContentRejection(undefined)).toBe(false)
    expect(isContentRejection("")).toBe(false)
  })
})

describe("local ffmpeg failures are never content rejections (2026-07-20 sweep false positives)", () => {
  // The real shape: runFfmpeg prefixes "ffmpeg failed:" and appends raw
  // stderr, whose filter-graph diagnostics contain the word "filtered".
  const FFMPEG_WALL =
    "ffmpeg failed: ffmpeg version n8.1.2 Copyright (c) 2000-2026 the FFmpeg developers\n" +
    "[vf#0:0] No filtered frames for output stream, trying to initialize anyway.\n" +
    "[mjpeg] Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial to use it.\n" +
    "Conversion failed!"

  it("the extract-frame wall is not a rejection and stays retryable", () => {
    expect(isContentRejection(FFMPEG_WALL)).toBe(false)
    expect(isRetryableFailure(FFMPEG_WALL)).toBe(true)
  })

  it('bare "filtered" no longer matches; provider phrasings still do', () => {
    expect(isContentRejection("No filtered frames for output stream")).toBe(false)
    expect(isContentRejection("Your image was filtered by the safety system")).toBe(true)
    expect(isContentRejection("Prompt content filtered")).toBe(true)
    expect(isContentRejection("Output filtered due to policy")).toBe(true)
  })
})

describe("copyright / likeness messages are rejections (W0)", () => {
  const COPYRIGHT_A =
    "The provider declined this generation: the output may resemble protected (copyrighted) content. Rephrasing the prompt usually resolves this."
  const COPYRIGHT_B =
    "Blocked for copyright: the provider refused this generation because the output may contain copyrighted material (recognizable characters, footage, music, or logos)."
  const LIKENESS =
    "The provider declined this generation because it may depict a real person's likeness. Use a stylized or non-photoreal reference, or switch to a model that allows likeness edits."
  const SAFETY =
    "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image."

  it("all three classes are content rejections and non-retryable", () => {
    for (const m of [COPYRIGHT_A, COPYRIGHT_B, LIKENESS, SAFETY]) {
      expect(isContentRejection(m)).toBe(true)
      expect(isRetryableFailure(m)).toBe(false)
    }
  })

  it("rejectionClassOf names the class", () => {
    expect(rejectionClassOf(COPYRIGHT_A)).toBe("copyright")
    expect(rejectionClassOf(COPYRIGHT_B)).toBe("copyright")
    expect(rejectionClassOf(LIKENESS)).toBe("likeness")
    expect(rejectionClassOf(SAFETY)).toBe("safety")
    expect(rejectionClassOf("Provider timeout after 30s")).toBeNull()
    expect(rejectionClassOf(null)).toBeNull()
  })
})

describe("failureGuidance (PR9 — offers the safety-block fallback)", () => {
  it("offers the suggestedProvider when the safety-block hint carries one", () => {
    const result = failureGuidance({
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
    })
    expect(result.retryable).toBe(false)
    expect(result.suggestedProvider).toBe("nano-banana-pro")
    expect(result.guidance).toBe(
      'The provider\'s safety filter blocked this output twice; retry the SAME prompt and references with provider "nano-banana-pro".',
    )
  })

  it("offers the change-the-input guidance when the hint has no fallback", () => {
    const result = failureGuidance({
      error_message: "Blocked for copyright: the provider refused this generation.",
      error_hint: { kind: "safety-block", class: "copyright", retried: false },
    })
    expect(result.retryable).toBe(false)
    expect(result.suggestedProvider).toBeUndefined()
    expect(result.guidance).toBe(
      "The provider's safety filter blocked this output; change the prompt or the input image.",
    )
  })

  it("falls back to the existing retryable/non-retryable sentences with no error_hint", () => {
    const nonRetryable = failureGuidance({
      error_message: "Content policy violation: The output was blocked by the provider's safety filter.",
    })
    expect(nonRetryable.retryable).toBe(false)
    expect(nonRetryable.suggestedProvider).toBeUndefined()
    expect(nonRetryable.guidance).toMatch(/do NOT retry/)

    const retryable = failureGuidance({ error_message: "Provider timeout after 30s" })
    expect(retryable.retryable).toBe(true)
    expect(retryable.suggestedProvider).toBeUndefined()
    expect(retryable.guidance).toMatch(/may be transient/)
  })

  it("retryable is isRetryableFailure(error_message) — unaffected by the hint's presence", () => {
    // A safety-block hint's message already reads as non-retryable via the
    // keyword classifier, so `retryable` agrees without special-casing it.
    const message = "The provider's safety filter blocked this output."
    const result = failureGuidance({
      error_message: message,
      error_hint: { kind: "safety-block", class: "safety", retried: true },
    })
    expect(result.retryable).toBe(isRetryableFailure(message))
    expect(result.retryable).toBe(false)
  })

  /**
   * The ONE place the hint is authoritative over `isRetryableFailure`
   * (spec 2026-09-03-job-policy-hook-design §6.5). Every safety-block message
   * is written by us or KIE and already trips NON_RETRYABLE_PATTERNS, so the
   * "hint is additive" doctrine holds there. A POLICY block's reason is
   * written by an arbitrary registered policy — "לא ניתן ליצור תוכן כזה", say —
   * matches no pattern, and `isRetryableFailure` would answer `true`, so an
   * MCP agent re-runs a permanently blocked request in a loop.
   */
  it("forces retryable:false for a policy-block hint even when the message reads as retryable", () => {
    const message = "Blocked: this request is not allowed here."
    // Proof the deviation is load-bearing, not defensive: the classifier alone
    // says "retry this".
    expect(isRetryableFailure(message)).toBe(true)

    const result = failureGuidance({
      error_message: message,
      error_hint: { kind: "policy-block", policyId: "sai-moderation", reason: "Nudity", hookPoint: "result" },
    })
    expect(result.retryable).toBe(false)
    expect(result.suggestedProvider).toBeUndefined()
    // It must NOT blame the provider — there is no other model to try.
    expect(result.guidance).toMatch(/not by the model provider/i)
    expect(result.guidance).toContain("Nudity")
  })

  it("policy-block guidance survives a hint with no reason string", () => {
    const result = failureGuidance({
      error_message: "Blocked.",
      error_hint: { kind: "policy-block", policyId: "p", hookPoint: "request" },
    })
    expect(result.retryable).toBe(false)
    expect(result.guidance).toMatch(/content policy/i)
  })

  it("a policy-block hint wins over the safety-block arm when both words appear in the message", () => {
    const result = failureGuidance({
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "policy-block", policyId: "p", reason: "Blocked by content policy", hookPoint: "result" },
    })
    expect(result.guidance).not.toMatch(/change the prompt or the input image/)
    expect(result.retryable).toBe(false)
  })

  it("ignores a malformed/unknown error_hint shape and falls back to the plain sentences", () => {
    const result = failureGuidance({
      error_message: "Provider timeout after 30s",
      error_hint: { kind: "something-else" },
    })
    expect(result.retryable).toBe(true)
    expect(result.suggestedProvider).toBeUndefined()
    expect(result.guidance).toMatch(/may be transient/)
  })
})
