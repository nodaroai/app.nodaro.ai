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

  it("marks a provider no-match NON-retryable without calling it a rejection", () => {
    // Grounded SAM found zero regions for the mask prompt
    // (providers/replicate/failure-messages.ts). Re-running the identical
    // request fails identically, but nothing was blocked.
    const noMatch =
      "No region matched the mask prompt. Try a shorter, plainer subject phrase " +
      '(for example "the hat" rather than a long description) and run again.'
    expect(isRetryableFailure(noMatch)).toBe(false)
    expect(isContentRejection(noMatch)).toBe(false)
    expect(rejectionClassOf(noMatch)).toBeNull()
  })

  describe("UGC speech-split failures are deterministic: NON-retryable, not rejections", () => {
    // The real message shapes the split job throws (uppercase code, then a
    // sentence). The classifier lowercases before matching.
    const SPLIT_FAILURES = {
      ALIGNMENT_MISMATCH: "ALIGNMENT_MISMATCH: the word timings have 41 words, the script 43",
      segmentTexts: "segmentTexts: segment 2 holds no words",
      SPEECH_TOO_LONG:
        "SPEECH_TOO_LONG: the recording holds 74 s of speech; the limit is 60 s. Shorten the script.",
      NO_PAUSE_SET:
        "NO_PAUSE_SET: no set of pauses cuts the take into at most 4 segments of at most 15 s of speech (pauses at 3.10, 7.42 s)",
    }

    for (const [code, message] of Object.entries(SPLIT_FAILURES)) {
      it(`${code} reads as a permanent failure`, () => {
        expect(isRetryableFailure(message)).toBe(false)
        expect(isContentRejection(message)).toBe(false)
        expect(rejectionClassOf(message)).toBeNull()
        const guidance = failureGuidance({ error_message: message })
        expect(guidance.retryable).toBe(false)
        expect(guidance.guidance).toMatch(/do NOT retry/)
      })
    }

    it("an ordinary transient error still reads as transient", () => {
      const transient = "Provider timeout after 30s while aligning the speech"
      expect(isRetryableFailure(transient)).toBe(true)
      expect(failureGuidance({ error_message: transient }).guidance).toMatch(/may be transient/)
    })
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

  it("a credits hint says the run ran out of credits: top up, then retry — not retryable as-is", () => {
    const message = "You don't have enough credits to finish this run. Top up and try again."
    const result = failureGuidance({
      error_message: message,
      error_hint: { kind: "credits", code: "insufficient_credits" },
    })
    expect(result.retryable).toBe(false)
    expect(result.suggestedProvider).toBeUndefined()
    expect(result.guidance).toMatch(/ran out of credits/i)
    expect(result.guidance).toMatch(/refunded/i)
    expect(result.guidance).toContain("check_balance")
    // The refusal code is named so an agent can tell a balance from a cap.
    expect(result.guidance).toContain("insufficient_credits")
  })

  it("a credits hint with a malformed code still gets the top-up guidance, without echoing the code", () => {
    const result = failureGuidance({
      error_message: "Failed.",
      error_hint: { kind: "credits", code: "Not a token <b>" },
    })
    expect(result.retryable).toBe(false)
    expect(result.guidance).toMatch(/ran out of credits/i)
    expect(result.guidance).not.toContain("<b>")
  })

  it("an input-refused hint is not retryable and asks for a different clip, even when the message reads as transient", () => {
    const message = "File processing failed"
    // Proof the hint is load-bearing: the classifier alone says "retry this".
    expect(isRetryableFailure(message)).toBe(true)

    const result = failureGuidance({
      error_message: message,
      error_hint: { kind: "input-refused", subject: "input_video" },
    })
    expect(result.retryable).toBe(false)
    expect(result.suggestedProvider).toBeUndefined()
    expect(result.guidance).toMatch(/refused the input video itself/)
    expect(result.guidance).toMatch(/different clip/)
    expect(result.guidance).not.toMatch(/may be transient/)
  })

  it("a safety-block on the input video asks for a different clip, not a fallback model or a new prompt", () => {
    const result = failureGuidance({
      error_message: "Blocked for copyright: the provider refused this generation.",
      error_hint: {
        kind: "safety-block",
        class: "copyright",
        retried: false,
        subject: "input_video",
        suggestedProvider: "some-fallback-model",
      },
    })
    expect(result.retryable).toBe(false)
    // The clip is what was refused: the fallback would be sent the same clip.
    expect(result.suggestedProvider).toBeUndefined()
    expect(result.guidance).toMatch(/refused the input video itself/)
    expect(result.guidance).toMatch(/different clip/)
    expect(result.guidance).not.toMatch(/change the prompt or the input image/)
  })

  it("a safety-block WITHOUT subject keeps today's guidance", () => {
    const plain = failureGuidance({
      error_message: "Blocked for copyright: the provider refused this generation.",
      error_hint: { kind: "safety-block", class: "copyright", retried: false },
    })
    expect(plain.retryable).toBe(false)
    expect(plain.guidance).toBe("The provider's safety filter blocked this output; change the prompt or the input image.")

    const withFallback = failureGuidance({
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
    })
    expect(withFallback.suggestedProvider).toBe("nano-banana-pro")
    expect(withFallback.guidance).not.toMatch(/different clip/)
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
